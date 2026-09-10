-- Album names often arrive from a Google Places search and come through wrong,
-- so any approved member may correct one - not just its creator or an admin.
-- Folder deletion stays admin-only (see locations_delete).
drop policy if exists locations_update on public.locations;

create policy locations_update on public.locations
  for update
  using (public.is_approved_member())
  with check (public.is_approved_member());
