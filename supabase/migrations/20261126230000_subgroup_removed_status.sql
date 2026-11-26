-- A member who is removed from a subgroup must not be able to rejoin on their
-- own. `inactive` keeps meaning "left voluntarily and may come back".
--
-- PostgreSQL cannot use a new enum value in the transaction that adds it, so
-- this statement lives alone and the functions that use it follow in the next
-- migration.
alter type public.subgroup_membership_status add value if not exists 'removed';
