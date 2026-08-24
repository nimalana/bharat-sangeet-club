-- Resource links remain visible to every signed-in member, but only club
-- executives and administrators may change their posted information. Column-
-- level UPDATE privileges prevent clients from rewriting authorship metadata.
revoke all on table public.resource_links from authenticated;
grant select, insert, delete on table public.resource_links to authenticated;
grant update (title, description, url) on table public.resource_links to authenticated;

create policy "Executives update resource links"
on public.resource_links
for update
to authenticated
using ((select private.is_executive()))
with check ((select private.is_executive()));
