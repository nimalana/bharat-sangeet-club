-- Removes the e2e accounts themselves (auth.users, identities, profiles). Run cleanup.mjs and cleanup.sql first:
-- an account that still owns finance records or recordings cannot be deleted (those foreign keys are restrict).
-- After this, gen-setup-sql.mjs has to be run again before the suite can sign in.
delete from auth.users where email like 'e2e-%@example.com';
select count(*) as e2e_accounts_left from auth.users where email like 'e2e-%@example.com';
