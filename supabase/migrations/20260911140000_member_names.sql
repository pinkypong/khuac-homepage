-- Names, and only names.
--
-- members_select deliberately keeps a member's row to themselves, because the
-- table also holds email and the publishable key ships inside the browser
-- bundle: widening that policy would hand every logged-in member the whole
-- roster's addresses. But the same policy is why a comment is signed
-- "알 수 없음", and why the uploader's name has been blank on every photo since
-- the first migration.
--
-- A view owned by the migration role reads members without RLS and exposes
-- exactly two columns, so email is unreachable through it by construction
-- rather than by policy. The body still gates on the caller: an unapproved
-- account gets an empty roster, not the club's.
create view public.member_names
with (security_invoker = off) as
  select id, name
  from public.members
  where public.is_approved_member();

revoke all on public.member_names from anon;
grant select on public.member_names to authenticated;
