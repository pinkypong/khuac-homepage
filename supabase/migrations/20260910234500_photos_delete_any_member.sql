-- The club treats the shared album as communal: any approved member may remove
-- a photo, not just its uploader or an admin. Activity and folder deletion
-- stay admin-only (see hikes_delete / locations_delete).
drop policy if exists photos_delete on public.photos;

create policy photos_delete on public.photos
  for delete using (public.is_approved_member());
