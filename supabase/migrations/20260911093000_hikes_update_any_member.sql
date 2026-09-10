-- Activity names come from the same Google Places search as album names and
-- land wrong just as often, so any approved member may correct one - matching
-- locations_update. This also lets anyone attach a GPX track to an outing they
-- did not create (see saveHikeTrack). Activity deletion stays admin-only.
drop policy if exists hikes_update on public.hikes;

create policy hikes_update on public.hikes
  for update
  using (public.is_approved_member())
  with check (public.is_approved_member());
