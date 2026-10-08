// Keep the canonical fresh installer reproducible from the checked-in upgrade
// chain. No connection, credentials or deployment is used by this generator.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8').replace(/\r\n/g,'\n');
const schemaPath=resolve(root,'supabase/schema.sql');
const start='-- BEGIN GENERATED FRESH BOOTSTRAP';
const end='-- END GENERATED FRESH BOOTSTRAP';
const removeBlocks=new RegExp(`${start}[^\n]*\n[\\s\\S]*?${end}[^\n]*\n*`,'g');
let base=read('supabase/schema.sql').replace(removeBlocks,'');
// Existing canonical sections contain transaction boundaries copied from
// migrations. A fresh install must commit once, after every dependency exists.
base=base.replace(/^(?:begin;|commit;)\s*$/gmi,'').trim();
const supplement=[
 'stripe-billing.sql','billing-columns-lockdown.sql','customers-trn.sql',
 'product-missing-columns.sql','invoice-missing-columns.sql','invoice-doc-type.sql',
 'follow-ups.sql','tool-jobs.sql','recurring-invoices.sql','customer-portal.sql',
 'po-payments-migration.sql',
];
const excluded=new Set([
 // Advisor helper rls_auto_enable belongs to Supabase's managed tooling, not
 // the app bootstrap. Final function ACL hardening below covers app routines.
 '2026-07-11-function-grants-hardening.sql',
]);
const dated=readdirSync(resolve(root,'supabase')).filter(p=>/^2026-\d\d-\d\d-.*\.sql$/.test(p)
  && p.slice(0,10)<='2026-10-03'&&!excluded.has(p)).sort();
const sources=[...supplement,...dated];
// Current changes stay at the end, after all ownership/module/MFA definitions.
// Root coordinates this allowlist when another audit owner freezes a migration.
const currentSources=['2026-10-04-document-number-authority.sql','2026-10-04-atomic-lead-setup.sql','2026-10-04-atomic-business-workflows.sql','2026-10-04-atomic-recurrence.sql','2026-10-04-stripe-invoice-total-parity.sql','2026-10-04-cloud-storage-privacy.sql','2026-10-04-scheduled-agent-privacy.sql','2026-10-04-ai-credit-test-promotion.sql','2026-10-04-ai-credit-checkout-resume.sql','2026-10-04-ai-completion-recovery.sql','2026-10-06-letter-rich-document.sql','2026-10-07-removed-member-workspace-recovery.sql','2026-10-07-profile-workspace-authority.sql','2026-10-07-mascot-avatars.sql','2026-10-07-document-save-performance.sql','2026-10-08-audit-artwork-metadata.sql','2026-10-08-supplier-invoice-details.sql'];
function withoutTransactions(sql) {return sql.replace(/^(?:begin;|commit;)\s*$/gmi,'').trim();}
const blocks=sources.map(file=>{
 const sql=withoutTransactions(read('supabase/'+file));
 const sourceHash=createHash('sha256').update(sql).digest('hex');
 if(sql.includes('$filey_bootstrap_source$')) throw new Error('Reserved bootstrap delimiter: '+file);
 return `-- Source: supabase/${file}\ndo $filey_bootstrap$\nbegin\n  if exists(select 1 from public.filey_bootstrap_migrations where name='${file}' and source_sha256<>'${sourceHash}') then\n    raise exception 'Installed bootstrap source ${file} changed. Use a new reviewed upgrade migration instead of rewriting installed history.';\n  end if;\n  if not exists(select 1 from public.filey_bootstrap_migrations where name='${file}') then\n    execute $filey_bootstrap_source$\n${sql}\n$filey_bootstrap_source$;\n    insert into public.filey_bootstrap_migrations(name,source_sha256) values('${file}','${sourceHash}');\n  end if;\nend;\n$filey_bootstrap$;`;
}).join('\n\n');
const foundation=`${start} prerequisite guard\nbegin;\ndo $filey_bootstrap$\nbegin\n  if to_regclass('public.filey_bootstrap_migrations') is null and exists(\n    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace\n      where n.nspname='public' and c.relkind in ('r','p','v','m','f')\n        and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')\n  ) then\n    raise exception 'This canonical installer is for fresh Filey databases. Use the documented upgrade migrations for an existing installation.';\n  end if;\nend;\n$filey_bootstrap$;\ncreate table if not exists public.filey_bootstrap_migrations (\n  name text primary key,\n  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),\n  installed_at timestamptz not null default now()\n);\nalter table public.filey_bootstrap_migrations enable row level security;\nrevoke all on public.filey_bootstrap_migrations from public,anon,authenticated;\n${end} prerequisite guard\n\n`;
const featureBlock=`${start} feature chain\n${blocks}\n${end} feature chain\n\n`;
const anchor='-- Shared records are readable, never writable, by ordinary recipients.';
if(!base.includes(anchor)) throw new Error('Canonical feature insertion anchor missing');
base=base.replace(anchor,()=>featureBlock+anchor);
const syncTables=[...read('src/lib/syncTables.ts').matchAll(/^\s+"(\w+)",?$/gm)].map(m=>m[1]);
if(syncTables.length!==45) throw new Error('Review the bootstrap Realtime list when the app sync manifest changes');
const current=`\n\n${start} current authority\n${currentSources.map(file=>`-- Source: supabase/${file}\n${withoutTransactions(read('supabase/'+file))}`).join('\n\n')}\n${end} current authority\n`;
// Auth may already contain accounts when the SQL editor installs Filey for the
// first time. Signup's AFTER INSERT trigger cannot provision existing rows.
// Match that trusted trigger once; repeating an install must not resurrect a
// deliberately removed profile or change any existing membership.
const authProvision=`for u in select a.* from auth.users a left join public.profiles p on p.id=a.id where p.id is null loop
    insert into public.organizations(id,name,owner_id) values(gen_random_uuid(),coalesce(u.email,'My Organization'),u.id) returning id into v_org;
    insert into public.profiles(id,email,name,org_id) values(u.id,coalesce(u.email,''),coalesce(u.raw_user_meta_data->>'full_name','User'),v_org::text);
    insert into public.org_members(org_id,user_id,role) values(v_org::text,u.id,'owner') on conflict(org_id,user_id) do nothing;
  end loop;`;
const authProvisionHash=createHash('sha256').update(authProvision).digest('hex');
const authExisting=`\n\n${start} existing Auth provisioning\ndo $filey_bootstrap$ declare u auth.users; v_org uuid; begin\n  if exists(select 1 from public.filey_bootstrap_migrations where name='filey-existing-auth-users-v1' and source_sha256<>'${authProvisionHash}') then\n    raise exception 'Installed Auth provisioning changed. Use a reviewed upgrade migration.';\n  end if;\n  if not exists(select 1 from public.filey_bootstrap_migrations where name='filey-existing-auth-users-v1') then\n    ${authProvision}\n    insert into public.filey_bootstrap_migrations(name,source_sha256) values('filey-existing-auth-users-v1','${authProvisionHash}');\n  end if;\nend;\n$filey_bootstrap$;\n${end} existing Auth provisioning\n`;
const final=`\n\n${start} final privileges\n-- Preserve the deliberate public share gates and PostgREST MFA pre-request.\n-- Every other app definer RPC uses its explicit authenticated/service grants.\ndo $filey_bootstrap$ declare f record; t text; begin\n  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace\n    where n.nspname='public' and p.prosecdef\n      and p.proname not in ('get_shared_doc','get_shared_invoice','filey_mfa_allowed','filey_assert_mfa') loop\n    execute format('revoke execute on function %s from public,anon',f.signature);\n  end loop;\n  foreach t in array array[${syncTables.map(t=>`'${t}'`).join(',')}] loop\n    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then\n      execute format('alter publication supabase_realtime add table public.%I',t);\n    end if;\n  end loop;\nend;\n$filey_bootstrap$;\ncommit;\n${end} final privileges\n`;
const output=foundation+base+current+authExisting+final;
if(process.argv.includes('--write')) writeFileSync(schemaPath,output);
else if(read('supabase/schema.sql')!==output) throw new Error('Canonical bootstrap is stale. Run node scripts/build-schema-bootstrap.mjs --write');
console.log(`${process.argv.includes('--write')?'Generated':'Verified'} canonical bootstrap: ${sources.length} historical feature sources, ${currentSources.length} current upgrades; one transaction; tracked repeated install.`);
