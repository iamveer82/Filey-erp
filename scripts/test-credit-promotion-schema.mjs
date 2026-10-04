import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {creditPromotionSchemaIssues,featureFunctionSources} from './runtime-schema-checks.mjs';
const sources=featureFunctionSources(readFileSync(new URL('../supabase/2026-10-04-ai-credit-test-promotion.sql',import.meta.url),'utf8'));
function fixture() {
  return {tables:[{table:'ai_credit_orders',rls:true,authenticated:null,anon:null}],
    columns:Object.entries({promotion_id:'uuid',promotion_discount_id:'text',promotion_discount_code:'text',promotion_customer_id:'text',
      promotion_email:'text',promotion_expires_at:'timestamptz',expected_paid_cents:'int8',checkout_session_id:'text'})
      .map(([column,type])=>({table:'ai_credit_orders',column,type})),
    indexes:[['ai_credit_promotion_once','promotion_id'],['ai_credit_promotion_discount_once','promotion_discount_id']]
      .map(([name,column])=>({table:'ai_credit_orders',name,columns:[column],unique:true,valid:true,predicate:'(promotion_id IS NOT NULL)'})),
    functions:[{name:'filey_ai_wallet',args:'text, uuid, jsonb',result:'jsonb',definer:true,config:['search_path=public, pg_temp'],
      authenticated:false,anon:false,service_role:true,source:sources.get('filey_ai_wallet')}]};
}
test('current Coin promotion metadata and exact wallet body satisfy the private deployment contract',()=>{
  assert.deepEqual(creditPromotionSchemaIssues(fixture(),sources),[]);
});
test('old schemas and failed/invalid one-use indexes cannot pass promotion deployment verification',()=>{
  const data=fixture();data.columns=data.columns.filter(item=>item.column!=='expected_paid_cents');
  data.indexes[0].unique=false;data.indexes[1].valid=false;
  assert.deepEqual(creditPromotionSchemaIssues(data,sources),['Missing Coin promotion column: expected_paid_cents',
    'Missing Coin promotion uniqueness: ai_credit_promotion_once','Missing Coin promotion uniqueness: ai_credit_promotion_discount_once']);
});
test('client order grants or wallet execution are rejected before a promotion release',()=>{
  const data=fixture();data.tables[0].authenticated=['SELECT'];data.tables[0].anon=['INSERT'];data.functions[0].authenticated=true;
  assert.deepEqual(creditPromotionSchemaIssues(data,sources),['Unexpected private Coin order grants: authenticated',
    'Unexpected private Coin order grants: anon','Unexpected private Coin wallet contract']);
});
test('the previous positive-only wallet or a stale alternate RPC overload fails the exact deployed-body check',()=>{
  const data=fixture();data.functions[0].source=featureFunctionSources(readFileSync(new URL('../supabase/2026-10-03-ai-credit-payment-safety.sql',import.meta.url),'utf8')).get('filey_ai_wallet');
  assert.deepEqual(creditPromotionSchemaIssues(data,sources),['Coin promotion wallet function drift']);
  const duplicate=fixture();duplicate.functions.push({...duplicate.functions[0],args:'text, uuid'});
  assert.deepEqual(creditPromotionSchemaIssues(duplicate,sources),['Unexpected private Coin wallet contract']);
});
