-- The named points a course passes, with their coordinates.
--
-- An album made from a suggested course kept its waypoints as a sentence -
-- "AI 추천 코스: 밤골탐방지원센터 → 숨은벽능선 → 백운대" - which reads fine and
-- cannot be drawn. The map had one pin carrying the whole list, so every name
-- sat on a single point at the start of a seven-kilometre line.
--
-- Held as [{name, lat, lng}] rather than as a table of its own: they are part
-- of this album the way its track is, they are never queried across albums,
-- and they arrive and leave together.
alter table public.hikes add column route_waypoints jsonb;

comment on column public.hikes.route_waypoints is
  '코스 경유지 [{name, lat, lng}]. 지도에서 폴리라인 위 실제 위치에 표시한다.';
