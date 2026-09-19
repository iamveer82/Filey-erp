-- Simulate trusted, verified webhook state using the actual production RPC.
select filey_apply_dodo_subscription('qa-subscription','owner1@example.invalid','qa-customer',
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','active',now()+interval '1 month',now()-interval '5 minutes');
set role authenticated;
select set_config('test.uid','20000000-0000-0000-0000-000000000007',false);
-- The staff member uses the paying WORKSPACE allowance, not their own plan.
insert into invoice_docs(id,notes) select 1000+n,'Paid team invoice' from generate_series(1,7) n;
reset role;
select filey_apply_dodo_subscription('qa-subscription','owner1@example.invalid','qa-customer',null,null,
 'past_due',now()+interval '1 month',now()-interval '4 minutes');
set role authenticated;
insert into invoice_docs(id,notes) values(1010,'Grace period');
reset role;
select filey_apply_dodo_subscription('qa-subscription','owner1@example.invalid','qa-customer',null,null,
 'active',now()+interval '2 months',now()-interval '3 minutes');
select filey_apply_dodo_subscription('qa-subscription','owner1@example.invalid','qa-customer',null,null,
 'cancelled',now()+interval '2 months',now()-interval '2 minutes');
do $$ begin
 if filey_apply_dodo_subscription('qa-subscription','owner1@example.invalid','qa-customer',null,null,
   'active',now()+interval '1 month',now()-interval '4 minutes')<>'ignored older event' then raise exception 'Old renewal reactivated cancellation'; end if;
 if (select count(*) from pending_entitlements where dodo_subscription_id='qa-subscription')<>1 then raise exception 'Duplicate webhook duplicated entitlement'; end if;
 if has_function_privilege('authenticated','public.filey_apply_dodo_subscription(text,text,text,text,uuid,text,timestamptz,timestamptz)','execute') then raise exception 'Client can grant paid access'; end if;
end $$;
set role authenticated;
do $$ begin
 begin insert into invoice_docs(id) values(1011); raise exception 'Cancelled subscription bypasses cap';
 exception when raise_exception then if sqlerrm not like 'Basic plan limit reached%' then raise; end if; end;
 update invoice_docs set notes='Still editable after cancellation' where id=1001;
 if not found then raise exception 'Cancellation prevented editing'; end if;
end $$;
reset role;
select 'PASS: subscription activation, shared paid allowance, failed renewal grace, renewal, cancellation, out-of-order replay and unlimited edits after downgrade.';
