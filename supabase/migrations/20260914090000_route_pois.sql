-- The club's own gazetteer of the places its routes are described by.
--
-- Route answers name waypoints the way climbers do - 해골바위, 밤골, 깔딱고개,
-- 자운암 능선 - and those names are local usage, not map labels. Looking each
-- one up by name put 해골바위 eight kilometres east of 숨은벽 능선, on the far
-- side of 북한산, and the course was drawn across the mountain to reach it.
--
-- A search engine cannot be corrected. This table can: once a member fixes a
-- point, every future course that names it is right, and the club's map gets
-- more accurate the more it is used rather than re-guessing every time.
create table public.route_pois (
  id uuid primary key default gen_random_uuid(),
  -- The canonical name, matched case- and space-insensitively (see
  -- src/lib/routes/poi.ts for the normalisation the lookup uses).
  name text not null,
  -- Other names the same place goes by: 백운대탐방지원센터 is also 도선사.
  -- Held as an array so one row answers to all of them.
  aliases text[] not null default '{}',
  lat double precision not null,
  lng double precision not null,
  -- trailhead / peak / crag / landmark / shelter - what kind of thing this is,
  -- which decides nothing today but is the natural thing to filter on later.
  kind text,
  -- Why this point is where it is: "GPX에서 찍음", "2026 가을 산행 사진".
  note text,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per name. A second 해골바위 would put the club back to guessing
-- which one a course meant, which is the problem this table exists to end.
create unique index route_pois_name_key on public.route_pois (lower(name));
-- Lookups arrive as a batch of waypoint names, matched against both columns.
create index route_pois_aliases_idx on public.route_pois using gin (aliases);

alter table public.route_pois enable row level security;

-- Any approved member may read and add: the member who walked the route is
-- the one who knows where 해골바위 actually is, and making them ask an admin
-- to record it is how the table stays empty.
create policy route_pois_select on public.route_pois
  for select using (public.is_approved_member());

create policy route_pois_insert on public.route_pois
  for insert with check (public.is_approved_member());

create policy route_pois_update on public.route_pois
  for update using (public.is_approved_member()) with check (public.is_approved_member());

-- Deleting is an admin action. A wrong point should be corrected in place so
-- the name keeps resolving; removing it sends that name back to guesswork.
create policy route_pois_delete on public.route_pois
  for delete using (public.is_admin());
