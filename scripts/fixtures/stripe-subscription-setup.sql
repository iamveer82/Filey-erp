-- Synthetic billing workspaces only. No production rows or provider requests.
create table pending_entitlements(dodo_subscription_id text,plan_status text);
insert into auth.users values('00000000-0000-0000-0000-000000000005');
insert into organizations(id,name,owner_id,plan,plan_status,stripe_customer_id,stripe_subscription_id) values
 ('30000000-0000-0000-0000-000000000001','Stripe ordering','00000000-0000-0000-0000-000000000005','pro','active','cus_order','sub_old'),
 ('30000000-0000-0000-0000-000000000002','Dodo access','00000000-0000-0000-0000-000000000005','cloud','active','cus_dodo','sub_dodo'),
 ('30000000-0000-0000-0000-000000000003','Ultra access','00000000-0000-0000-0000-000000000005','ultra','active','cus_ultra','sub_ultra'),
 ('30000000-0000-0000-0000-000000000004','Stripe race','00000000-0000-0000-0000-000000000005','free','inactive','cus_race','sub_race'),
 ('30000000-0000-0000-0000-000000000005','License access','00000000-0000-0000-0000-000000000001','pro','active','cus_license','sub_license');
update organizations set dodo_subscription_id='dodo_current' where stripe_customer_id='cus_dodo';
insert into pending_entitlements values('dodo_current','active');
-- Reproduce the old webhook's blind customer update, and retain original data.
begin;
update organizations set plan='free',plan_status='canceled',stripe_subscription_id='sub_replaced'
  where stripe_customer_id='cus_order';
select assert_equal((select plan from organizations where stripe_customer_id='cus_order'),'free'::text,'Old delayed cancellation revokes a newer subscription');
rollback;
