-- The map is meant to work "일반 웹페이지처럼" - open it and see the club's
-- albums, no account required. Only making an album, editing one, or joining
-- a hike still needs to be a member; those are separate insert/update/delete
-- policies, already gated on is_approved_member() and ownership, and this
-- migration does not touch them.
--
-- photos and hike_participants stay approved-member-only on purpose. Whether
-- a photo with a face in it should be public is a separate, still-open
-- question (see photos.has_face and the face-detection work) - this migration
-- only opens what was never in question: the club's locations and the record
-- of what was done at them.
drop policy locations_select on public.locations;
create policy locations_select on public.locations
  for select using (true);

drop policy hikes_select on public.hikes;
create policy hikes_select on public.hikes
  for select using (true);

comment on policy locations_select on public.locations is
  'Public read - see this migration''s header for what stays member-only and why.';
comment on policy hikes_select on public.hikes is
  'Public read - see this migration''s header for what stays member-only and why.';
