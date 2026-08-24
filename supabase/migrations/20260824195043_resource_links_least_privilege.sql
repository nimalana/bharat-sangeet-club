-- Supabase projects may grant broad table privileges to authenticated through
-- default privileges. Keep this API surface limited to the operations exposed
-- by the resource-link UI; RLS remains the authorization boundary.
revoke all on table public.resource_links from authenticated;
revoke all on sequence public.resource_links_id_seq from authenticated;

grant select, insert, delete on table public.resource_links to authenticated;
grant usage, select on sequence public.resource_links_id_seq to authenticated;
