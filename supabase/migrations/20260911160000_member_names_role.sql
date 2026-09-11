-- The roster screen needs to say who the 운영진 are, and the crown beside a
-- name is read off the role. Neither role nor joined_at is sensitive the way
-- email is, so they can join name in the view rather than forcing the roster
-- to query members directly and hit members_select.
--
-- The view still returns pending members too: it is the lookup table for photo
-- and comment author names, and someone whose approval was revoked should not
-- retroactively blank out the captions on everything they ever uploaded. The
-- roster filters by role itself.
create or replace view public.member_names
with (security_invoker = off) as
  select id, name, role, joined_at
  from public.members
  where public.is_approved_member();

revoke all on public.member_names from anon;
grant select on public.member_names to authenticated;
