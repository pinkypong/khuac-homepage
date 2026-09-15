-- Courses the club already knows about, kept per mountain.
--
-- Every route question paid for a grounded web search: 26.7 seconds and 16
-- sources for one answer, measured. The searching is the whole cost - our own
-- code accounted for 30 milliseconds of a 35-second request - and it is spent
-- again on every rephrasing, because the answer cache is keyed by the question
-- and "북한산 코스 추천" is not "도선사로 하산하는 코스".
--
-- The courses themselves barely change. 북한산 has the same half-dozen ways up
-- it this year as last, so they are worth holding rather than re-deriving, and
-- the club goes to a handful of mountains.
--
-- Held per course rather than per answer so that a question can be served by
-- whichever of them fit it - the constraint in "5-6시간 중급" is applied to
-- what we hold, not used as part of a cache key.
create table public.course_library (
  id uuid primary key default gen_random_uuid(),
  -- The mountain, as the club spells it. The lookup key.
  mountain text not null,
  name text not null,
  -- Place names in walking order, the same shape the map resolves.
  waypoints jsonb not null default '[]'::jsonb,
  distance_text text,
  duration_text text,
  difficulty text,
  description text,
  notes text,
  -- Where it came from, so a course can be traced back and re-checked.
  sources jsonb not null default '[]'::jsonb,
  -- "search" for one the assistant found, "club" for one a member wrote down.
  origin text not null default 'search',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per course per mountain: the same course found again updates rather
-- than joining the list twice under a slightly different sentence.
create unique index course_library_mountain_name_key
  on public.course_library (lower(mountain), lower(name));
create index course_library_mountain_idx on public.course_library (lower(mountain));

alter table public.course_library enable row level security;

create policy course_library_select on public.course_library
  for select using (public.is_approved_member());

-- Written by the assistant on the member's behalf, and by a member correcting
-- a course by hand. Both are approved members; neither needs admin.
create policy course_library_write on public.course_library
  for all using (public.is_approved_member()) with check (public.is_approved_member());
