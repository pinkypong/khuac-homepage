-- Lets an admin remove an approved member without destroying club history.
--
-- photos.uploader_id was `not null ... on delete restrict`, which was harmless
-- while the only removable people were pending members who cannot upload. Now
-- that admins can remove approved members, that restrict would either block the
-- removal outright or force deleting someone's photos to get rid of them.
--
-- Neither is right: a hike album belongs to the club, not to whoever happened
-- to carry the camera. The photo stays and loses its name, exactly as
-- comments.author_id, hikes.created_by and locations.created_by already do.
-- Every caller already reads uploader_id as nullable and falls back to
-- "알 수 없음".

alter table public.photos alter column uploader_id drop not null;

alter table public.photos drop constraint photos_uploader_id_fkey;

alter table public.photos add constraint photos_uploader_id_fkey
  foreign key (uploader_id) references public.members (id) on delete set null;
