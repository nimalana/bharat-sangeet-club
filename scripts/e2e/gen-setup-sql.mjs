#!/usr/bin/env node
// Generates the SQL that creates the synthetic test accounts, and the secrets file with their
// passwords. Run it once per test project, then run the printed SQL in the Supabase SQL editor
// (or through any SQL tool). The SQL is idempotent: accounts that already exist are skipped, so
// the passwords of existing accounts are NOT changed (delete the account first to reset one).
//
//   node scripts/e2e/gen-setup-sql.mjs > /tmp/e2e-setup.sql
//
// The secrets file (default /tmp/claude-0/e2e/secrets.json, override with E2E_SECRETS) is kept
// outside the repository. If it already exists its passwords are reused.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { ACCOUNTS } from "./accounts.mjs";

const secretsPath = process.env.E2E_SECRETS || "/tmp/claude-0/e2e/secrets.json";
let secrets = { passwords: {} };
if (existsSync(secretsPath)) secrets = JSON.parse(readFileSync(secretsPath, "utf8"));
secrets.passwords ||= {};
for (const key of Object.keys(ACCOUNTS)) secrets.passwords[key] ||= randomBytes(18).toString("base64url");
mkdirSync(dirname(secretsPath), { recursive: true });
writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
try { chmodSync(secretsPath, 0o600); } catch { /* best effort */ }

const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const rows = Object.entries(ACCOUNTS).map(([key, a]) => `    (${q(key)}, ${q(a.email)}, ${q(a.name)}, ${q(secrets.passwords[key])}, ${q(a.profileRole)}, ${q(a.profileStatus || "active")})`).join(",\n");

console.log(`-- Synthetic accounts for scripts/e2e. Safe to run again; existing accounts are left alone,
-- except the applicant (a fresh sign-up the suite approves and deletes): it is made, or put back, pending.
-- The signup trigger (private.handle_new_user) creates each profile. Since the membership gate
-- (20261128010100) that trigger creates 'pending' profiles, so every account is made 'active' here
-- (in the same update as its role: a pending profile can only be a plain member), and only the
-- applicant is left pending. Before the gate migrations the applicant simply stays active and
-- tests/03-membership-gate.mjs skips itself.
do $e2e$
declare
  r record;
  uid uuid;
begin
  for r in select * from (values
${rows}
  ) as t(key, email, full_name, pw, profile_role, profile_status)
  loop
    if exists (select 1 from auth.users where email = r.email) then
      -- The applicant is used up by a run (approved, then deleted): if a run stopped half way, put it back to
      -- what a new sign-up is.
      if r.profile_status = 'pending' then
        begin
          delete from public.signup_reviews where member_id = (select id from auth.users where email = r.email);
          update public.profiles set status = 'pending', role = 'member' where email = r.email;
        exception when check_violation or undefined_table then
          raise notice '% stays as it is: the membership gate migrations are not applied on this project', r.email;
        end;
      end if;
      continue;
    end if;
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
      extensions.crypt(r.pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', r.full_name, 'e2e', true),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
    update public.profiles set role = r.profile_role::public.club_role, status = 'active' where id = uid;
    if r.profile_status = 'pending' then
      begin
        update public.profiles set status = 'pending' where id = uid;
      exception when check_violation then
        raise notice '% stays active: the membership gate migrations are not applied on this project', r.email;
      end;
    end if;
  end loop;
end
$e2e$;

select p.email, p.role, p.status from public.profiles p where p.email like 'e2e-%@example.com' order by p.email;
`);
console.error(`secrets written to ${secretsPath} (${Object.keys(secrets.passwords).length} accounts)`);
