-- Runs after 20260810234500 and before 20260812000000_admin_console.sql.
-- That migration raises unless the owner's profile exists and revokes a
-- function that only hosted Supabase creates, so both are provided here.
insert into auth.users (email, raw_user_meta_data)
select current_setting('replay.bootstrap_email'), '{"full_name":"Bootstrap Admin"}'::jsonb;
create function public.rls_auto_enable() returns void language sql as $$ select $$;
