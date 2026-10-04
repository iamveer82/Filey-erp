set role authenticated;
set test.uid='00000000-0000-4000-8000-000000000001';
do $$ begin
 begin perform filey_run_payroll(2,'2026-09',777,0,0,null,'2026-09-30','a',auth.uid()); raise exception 'Expected ledger rejection';
 exception when others then if sqlerrm not like '%Fixture contra ledger failure%' then raise; end if; end;
 if (select count(*) from payroll where employee_id=2)<>0 or (select count(*) from accounts)<>0 or (select count(*) from transactions)<>0 then raise exception 'Partial payroll escaped rollback'; end if;
 perform filey_run_payroll(2,'2026-09',100.10,10.20,10.30,null,'2026-09-30','a',auth.uid());
 if (select count(*) from transactions)<>2 or (select balance from accounts where account_type='expense')<>100 or (select balance from accounts where account_type='asset')<>-100 then raise exception 'Ledger is not balanced'; end if;
 begin perform filey_run_payroll(1,'2026-01',10,0,0,null,'2026-01-31','a',auth.uid()); raise exception 'Expected preserved legacy claim'; exception when unique_violation then null; end;
 begin perform filey_run_payroll(2,'2026-13',10,0,0,null,'2026-09-30','a',auth.uid()); raise exception 'Expected invalid month'; exception when invalid_parameter_value then null; end;
 begin perform filey_run_payroll(2,'2026-10',0.001,0,0,null,'2026-09-30','a',auth.uid()); raise exception 'Expected precision rejection'; exception when invalid_parameter_value then null; end;
 begin perform filey_run_payroll(2,'2026-10','NaN'::numeric,0,0,null,'2026-09-30','a',auth.uid()); raise exception 'Expected invalid amount'; exception when invalid_parameter_value then null; end;
 begin perform filey_run_payroll(2,'2026-10',10,0,0,null,'2026-09-30','b',auth.uid()); raise exception 'Expected workspace mismatch'; exception when insufficient_privilege then null; end;
 begin perform filey_run_payroll(2,'2026-10',10,0,0,null,'2026-09-30','a','00000000-0000-4000-8000-000000000002'); raise exception 'Expected actor mismatch'; exception when insufficient_privilege then null; end;
 begin perform filey_run_payroll(4,'2026-10',10,0,0,null,'2026-09-30','a',auth.uid()); raise exception 'Expected foreign employee'; exception when insufficient_privilege then null; end;
 begin perform filey_run_payroll(2,'2026-10',10,0,0,(select id from accounts where account_type='asset'),'2026-09-30','a',auth.uid()); raise exception 'Expected wrong account type'; exception when insufficient_privilege then null; end;
 begin insert into payroll(employee_id,period,basic,allowances,deductions,net_pay,status) values(4,'2026-10',10,0,0,10,'pending'); raise exception 'Expected direct foreign employee denial'; exception when insufficient_privilege then null; end;
 begin update payroll set period='2026-11' where employee_id=2; raise exception 'Expected identity edit denial'; exception when invalid_parameter_value then null; end;
 begin update payroll set basic=50 where employee_id=2; raise exception 'Expected amount edit denial'; exception when invalid_parameter_value then null; end;
 update payroll set status='paid' where employee_id=2;
 -- Deleting a posted run or its employee must not erase its salary claim.
 perform filey_run_payroll(5,'2026-08',0,0,0,null,'2026-08-31','a',auth.uid());
 delete from employees where id=5;
 insert into employees(id,user_id,org_id,name) values(5,auth.uid(),'a','Recreated employee');
 begin perform filey_run_payroll(5,'2026-08',0,0,0,null,'2026-08-31','a',auth.uid()); raise exception 'Expected deleted-run replay denial'; exception when unique_violation then null; end;
 begin delete from payroll_period_claims; raise exception 'Expected private claim mutation denial'; exception when insufficient_privilege then null; end;
 begin insert into payroll_period_claims(org_id,employee_id,period) values('a',2,'2026-12'); raise exception 'Expected private claim insertion denial'; exception when insufficient_privilege then null; end;
 begin update payroll_period_claims set period='2026-12'; raise exception 'Expected private claim edit denial'; exception when insufficient_privilege then null; end;
end $$;
set test.uid='00000000-0000-4000-8000-000000000002';
do $$ begin
 if exists(select 1 from payroll where employee_id=3) then raise exception 'Fixture must hide other author payroll'; end if;
 begin perform filey_run_payroll(3,'2026-01',20,0,0,null,'2026-01-31','a',auth.uid()); raise exception 'Expected hidden salary claim denial'; exception when unique_violation then null; end;
end $$;
reset role;
update org_members set modules=array['people'] where user_id='00000000-0000-4000-8000-000000000002';
set role authenticated;
set test.uid='00000000-0000-4000-8000-000000000002';
do $$ begin
 begin perform filey_run_payroll(3,'2026-10',20,0,0,null,'2026-10-31','a',auth.uid()); raise exception 'Expected accounting module denial'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
 begin perform filey_run_payroll(2,'2026-10',20,0,0,null,'2026-10-31','a','00000000-0000-4000-8000-000000000001'); raise exception 'Expected anonymous denial'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*) from payroll where employee_id=1 and period='2026-01')<>2 then raise exception 'Legacy runs were rewritten'; end if;
 if exists(select 1 from payroll_period_claims where employee_id=2 and period='2026-10') then raise exception 'Rejected calls retained claims'; end if;
 if (select count(*) from accounts)<>2 or (select count(*) from transactions)<>2 then raise exception 'Failed calls left account or ledger changes'; end if;
end $$;
select 'PASS: payroll rollback, balance, identity, period, private claims, legacy duplicates and module/actor boundaries.';
