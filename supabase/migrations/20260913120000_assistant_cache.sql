-- A club-wide cache for the assistant answers that cost money.
--
-- Only the "complex" path is stored: a course or judgment question spends two
-- Gemini calls (a grounded search and a formatting pass), while 위치 and 날씨
-- are answered from our own rows and Open-Meteo and cost nothing. Weather in
-- particular must never be cached - a stale forecast is a wrong forecast.
--
-- Shared rather than per-member on purpose: a climbing club asks about the
-- same mountains every season, so the second person to ask about 관악산 should
-- not pay for it again. The rows double as the "recent questions" list.
create table public.assistant_cache (
  id uuid primary key default gen_random_uuid(),
  -- Normalised question (see src/lib/assistant/cache.ts): lowercased, with
  -- whitespace collapsed, so trivial retypings share one row.
  question_key text not null unique,
  -- What was actually typed, which is what the recent-question chips show.
  question text not null,
  answer jsonb not null,
  asked_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The recent list reads newest-first; freshness checks read one key.
create index assistant_cache_created_at_idx on public.assistant_cache (created_at desc);

alter table public.assistant_cache enable row level security;

-- Any approved member reads and writes: an answer one member paid for is the
-- club's, and a refresh is just a newer answer to the same question.
create policy assistant_cache_select on public.assistant_cache
  for select using (public.is_approved_member());

create policy assistant_cache_insert on public.assistant_cache
  for insert with check (public.is_approved_member());

create policy assistant_cache_update on public.assistant_cache
  for update using (public.is_approved_member()) with check (public.is_approved_member());

-- Clearing the cache is an admin action, so a stale or wrong answer can be
-- removed without giving everyone the ability to wipe the club's history.
create policy assistant_cache_delete on public.assistant_cache
  for delete using (public.is_admin());
