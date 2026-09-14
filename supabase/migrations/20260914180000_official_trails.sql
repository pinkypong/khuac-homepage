-- Official Korean trail geometry, imported once rather than fetched.
--
-- OSM is good - 99km of trail around 백운대 at 14m vertex spacing - but it is
-- volunteer-contributed, and 산림청 and 국립공원공단 publish their own surveyed
-- routes. Neither source is reliably better: the forest service data has
-- documented gaps of its own (관악산 among them), so these are merged with OSM
-- rather than replacing it, and a path missing from one can be supplied by the
-- other.
--
-- Bulk-imported because there is nothing to poll. These files change a few
-- times a year and are published as downloads, not as an API worth calling at
-- request time - and a Worker that depends on no external service for them is
-- a Worker that keeps drawing routes when everything else is down.
--
-- Stored on the same 0.02° grid as trail_tiles so both sources answer the same
-- lookup. Kept in its own table because the lifecycle differs: trail_tiles is
-- a cache that refills itself, this is data we chose to hold.
create table public.official_trails (
  tile_key text not null,
  -- "forest" (산림청 등산로) or "park" (국립공원공단 탐방로) - which import
  -- these came from, so one can be replaced without disturbing the other.
  source text not null,
  segments jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (tile_key, source)
);

create index official_trails_tile_key_idx on public.official_trails (tile_key);

alter table public.official_trails enable row level security;

-- Read by any approved member, like the OSM cache beside it.
create policy official_trails_select on public.official_trails
  for select using (public.is_approved_member());

-- Written only by an import run, which uses the service role and bypasses RLS.
-- No member-facing policy exists on purpose: this is not something a browser
-- should be able to add to.
create policy official_trails_admin_write on public.official_trails
  for all using (public.is_admin()) with check (public.is_admin());
