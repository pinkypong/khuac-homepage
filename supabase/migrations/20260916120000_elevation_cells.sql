-- Ground height, on the grid the model that supplies it actually has.
--
-- A course card said "약 7.1km, 약 4시간" and nothing about whether that was a
-- walk or a ladder. The national park draws its courses side-on instead -
-- height against distance, named points along the bottom, the steep parts
-- marked - and everything needed to draw the same picture was already here
-- except the heights.
--
-- Copernicus DEM GLO-90 supplies them free and without a key, through
-- Open-Meteo. It is ninety metres to a sample, which is why the key is a cell
-- rather than a coordinate: asking for two points inside one cell asks the same
-- question twice and gets the same answer.
--
-- Cached because the ground does not move. A course is 45 to 60 samples and one
-- request answering in about a second; the second time anyone looks at that
-- course, or at any course crossing the same ridge, it is none and nothing.
-- 북한산 end to end is on the order of ten thousand cells, which is a quarter of
-- a megabyte - this table will not be what fills the database.
create table public.elevation_cells (
  -- "37649:126981" - the cell's index at the grid resolution in
  -- src/lib/routes/elevation.ts, which is the only thing that builds these.
  cell_key text primary key,
  -- Metres above sea level. Korea's highest is 1,950m and the model returns
  -- whole metres, so smallint is room to spare.
  elevation smallint not null,
  fetched_at timestamptz not null default now()
);

alter table public.elevation_cells enable row level security;

-- Readable by any approved member: it is a copy of open elevation data and
-- every member's course profile is drawn from it.
create policy elevation_cells_select on public.elevation_cells
  for select using (public.is_approved_member());

-- Written by members too, the same way trail tiles are: the cell is filled by
-- whoever first looks at a course crossing it, which keeps the cache warm
-- without anyone curating it.
create policy elevation_cells_insert on public.elevation_cells
  for insert with check (public.is_approved_member());

-- Clearing a cell is an admin action; the next course profile refills it.
create policy elevation_cells_delete on public.elevation_cells
  for delete using (public.is_admin());
