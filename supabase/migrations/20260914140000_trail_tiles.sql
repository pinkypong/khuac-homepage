-- The club's own copy of the trail geometry it draws with.
--
-- Routes were snapped by asking Overpass live on every preview. Overpass is a
-- volunteer-run service on a fair-use policy and it goes down: it answered 504
-- from the main instance twice in one day while this feature was being built,
-- and every course drew as a straight dashed line because of it - not for want
-- of a path but for want of a way to ask about one.
--
-- Trails do not move. Once a mountain's paths are here they can be drawn for
-- years without asking anyone, and Overpass is consulted only for ground the
-- club has never looked at.
--
-- Stored per grid tile rather than per course: two courses on 북한산 overlap
-- almost entirely, and keying by each course's own bounding box would fetch
-- the same paths again for every new question.
create table public.trail_tiles (
  -- "37.66,126.96" - the tile's south-west corner at TILE_DEG resolution.
  -- See src/lib/routes/tiles.ts, which is the only thing that builds these.
  tile_key text primary key,
  -- Every OSM way with a point inside this tile, in the TrailSegment shape the
  -- map draws from. A way crossing a boundary is stored in each tile it
  -- touches and de-duplicated by id on read, so a course near an edge is not
  -- left with half a path.
  segments jsonb not null,
  fetched_at timestamptz not null default now()
);

create index trail_tiles_fetched_at_idx on public.trail_tiles (fetched_at);

alter table public.trail_tiles enable row level security;

-- Readable by any approved member, since it is only a copy of open map data
-- and every member's map draws from it.
create policy trail_tiles_select on public.trail_tiles
  for select using (public.is_approved_member());

-- Written by members too: the tile is filled by whoever first looks at a
-- course there, which is what keeps the cache warm without anyone curating it.
create policy trail_tiles_insert on public.trail_tiles
  for insert with check (public.is_approved_member());

create policy trail_tiles_update on public.trail_tiles
  for update using (public.is_approved_member()) with check (public.is_approved_member());

-- Clearing a stale tile is an admin action; the next preview refills it.
create policy trail_tiles_delete on public.trail_tiles
  for delete using (public.is_admin());
