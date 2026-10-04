-- One payroll run and its balanced postings commit together. Preserve historic
-- duplicate rows while reserving their periods against any further duplicates.
begin;
create table if not exists public.payroll_period_claims (
  org_id text not null,
  -- Keep the claim if a employee/payroll is deleted: recreating its old ID
  -- must not make a previously posted salary payable again.
  employee_id bigint not null,
  period text not null,
  payroll_id bigint references public.payroll(id) on delete set null,
  primary key (org_id,employee_id,period)
);
alter table public.payroll_period_claims enable row level security;
revoke all on public.payroll_period_claims from public,anon,authenticated;
grant all on public.payroll_period_claims to service_role;
insert into public.payroll_period_claims(org_id,employee_id,period,payroll_id)
  select distinct on (org_id,employee_id,btrim(period)) org_id,employee_id,btrim(period),id
  from public.payroll where employee_id is not null and org_id is not null
  order by org_id,employee_id,btrim(period),id
  on conflict do nothing;

-- This narrow trigger owns only the private period claim. The caller's normal
-- payroll RLS still controls the row; users cannot forge or clear a claim.
create or replace function public.filey_claim_payroll_period() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if new.org_id is distinct from old.org_id or new.employee_id is distinct from old.employee_id
      or btrim(new.period) is distinct from btrim(old.period)
      or new.basic is distinct from old.basic or new.allowances is distinct from old.allowances
      or new.deductions is distinct from old.deductions or new.net_pay is distinct from old.net_pay then
      raise exception 'Posted payroll identity and amounts cannot be changed. Open the original payslip.' using errcode='22023';
    end if;
    return new;
  end if;
  new.period:=btrim(new.period);
  if new.employee_id is null or new.org_id is null or new.period is null
    or new.period !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then
    raise exception 'Choose an employee and a YYYY-MM payroll period.' using errcode='22023';
  end if;
  if not exists(select 1 from public.employees e where e.id=new.employee_id and e.org_id=new.org_id
    and (auth.uid() is null or e.user_id=auth.uid() or e.shared or public.is_org_admin()))
    or (auth.uid() is not null and (new.org_id is distinct from public.current_org()
      or not public.filey_can_use('people') or not public.filey_can_use('accounting'))) then
    raise exception 'Employee not found or payroll access denied.' using errcode='42501';
  end if;
  begin
    insert into public.payroll_period_claims(org_id,employee_id,period,payroll_id)
      values(new.org_id,new.employee_id,new.period,new.id);
  exception when unique_violation then
    raise exception 'Payroll is already recorded for this employee and period. Open the existing payslip instead.' using errcode='23505';
  end;
  return new;
end $$;
revoke all on function public.filey_claim_payroll_period() from public,anon,authenticated;
drop trigger if exists filey_claim_payroll_period on public.payroll;
create trigger filey_claim_payroll_period after insert or update of org_id,employee_id,period,basic,allowances,deductions,net_pay
  on public.payroll for each row execute function public.filey_claim_payroll_period();

create or replace function public.filey_run_payroll(
  p_employee bigint,p_period text,p_basic numeric,p_allowances numeric,p_deductions numeric,
  p_account bigint,p_date date,p_org text,p_actor uuid
) returns bigint language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_org text:=public.current_org(); v_id bigint;
  v_target bigint; v_cash bigint; v_net numeric; v_changed bigint;
begin
  if v_uid is null or p_actor is distinct from v_uid or p_org is distinct from v_org
    or v_org is null or not public.filey_can_use('people') or not public.filey_can_use('accounting') then
    raise exception 'Your account cannot post payroll in this workspace. Reopen People.' using errcode='42501';
  end if;
  p_period:=btrim(p_period);
  if p_employee is null or p_employee<=0 or p_period is null
    or p_period !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' or p_date is null
    or p_basic is null or p_allowances is null or p_deductions is null
    or p_basic::text in ('NaN','Infinity','-Infinity') or p_allowances::text in ('NaN','Infinity','-Infinity')
    or p_deductions::text in ('NaN','Infinity','-Infinity') or least(p_basic,p_allowances,p_deductions)<0
    or greatest(p_basic,p_allowances,p_deductions)>=1000000000000
    or p_basic<>round(p_basic,2) or p_allowances<>round(p_allowances,2) or p_deductions<>round(p_deductions,2)
    or (p_account is not null and p_account<=0) then
    raise exception 'Choose an employee, a YYYY-MM period, and non-negative pay amounts with at most 2 decimal places.' using errcode='22023';
  end if;
  v_net:=p_basic+p_allowances-p_deductions;
  if v_net<0 or v_net>=1000000000000 then raise exception 'Net pay is outside the valid range.' using errcode='22023'; end if;

  -- Serialize the workspace's automatic account selection, then use ordinary
  -- row locks and RLS. No read-modify-write balance is performed in a browser.
  perform pg_advisory_xact_lock(hashtextextended(v_org||':payroll',0));
  perform 1 from public.employees where id=p_employee and org_id=v_org for update;
  if not found then raise exception 'Employee not found or payroll access denied.' using errcode='42501'; end if;
  if p_account is not null then v_target:=p_account;
  else
    select id into v_target from public.accounts where org_id=v_org and account_type='expense'
      and (user_id=v_uid or public.is_org_admin()) and name ~* '\m(salary|salaries|payroll|wages?)\M' order by id limit 1;
    if v_target is null then
      insert into public.accounts(code,name,account_type,balance) values('5200','Salaries & Wages','expense',0) returning id into v_target;
    end if;
  end if;
  perform 1 from public.accounts where id=v_target and org_id=v_org and account_type='expense' for update;
  if not found then raise exception 'Choose an accessible expense account for payroll.' using errcode='42501'; end if;
  insert into public.payroll(employee_id,period,basic,allowances,deductions,net_pay,status)
    values(p_employee,p_period,p_basic,p_allowances,p_deductions,v_net,'pending') returning id into v_id;
  if v_net>0 then
    select id into v_cash from public.accounts where org_id=v_org and account_type='asset'
      and (user_id=v_uid or public.is_org_admin()) and name ~* '(cash|bank)' order by id limit 1;
    if v_cash is null then
      insert into public.accounts(code,name,account_type,balance) values('1000','Cash & Bank','asset',0) returning id into v_cash;
    end if;
    insert into public.transactions(account_id,txn_type,amount,description,ref,source,txn_date)
      values(v_target,'debit',v_net,'Payroll '||p_period,'Payroll '||v_id,'payroll',p_date),
        (v_cash,'credit',v_net,'Payroll '||p_period||' — paid','Payroll '||v_id,'payroll',p_date);
    update public.accounts set balance=balance+v_net where id=v_target and org_id=v_org returning id into v_changed;
    if v_changed is null then raise exception 'Expense account update denied.' using errcode='42501'; end if;
    v_changed:=null;
    update public.accounts set balance=balance-v_net where id=v_cash and org_id=v_org returning id into v_changed;
    if v_changed is null then raise exception 'Cash account update denied.' using errcode='42501'; end if;
  end if;
  return v_id;
end $$;
revoke all on function public.filey_run_payroll(bigint,text,numeric,numeric,numeric,bigint,date,text,uuid) from public,anon;
grant execute on function public.filey_run_payroll(bigint,text,numeric,numeric,numeric,bigint,date,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
