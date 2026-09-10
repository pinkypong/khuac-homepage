-- Locations aren't only mountains: the club also visits indoor climbing gyms
-- and outdoor crags. The type drives marker styling and tells the map which
-- places can have a walking route at all (a gym can't).
create type public.location_type as enum ('mountain', 'climbing_gym', 'crag');

alter table public.locations
  add column type public.location_type not null default 'mountain';

-- Route drawn on the map, as [[lat, lng], ...] taken from an uploaded GPX
-- track. Null means no GPX: the map then falls back to stringing together the
-- hike's photo EXIF coordinates, which is computed on read rather than stored
-- so it stays in sync as photos are added.
alter table public.hikes
  add column track jsonb;
