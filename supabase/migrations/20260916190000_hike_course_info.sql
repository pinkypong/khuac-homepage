-- What the answer said about a course, kept as fields rather than as a sentence.
--
-- An album made from a suggested course had all of it flattened into
-- description: "AI 추천 코스: 밤골탐방지원센터 → 숨은벽능선 → 백운대\n약 6.6km".
-- The waypoints were already stored properly in route_waypoints, so that line
-- was a second copy of them in a shape nothing can read; the distance and the
-- duration were prose; and the column that should hold what a member wants to
-- say about the walk was full of text nobody wrote.
--
-- Split here. route_waypoints holds the points, track holds the line, this
-- holds what the answer knew and geometry cannot tell us - how long it takes,
-- how hard it is, what to watch for - and description goes back to being the
-- member's own notes.
--
-- Not columns of its own: these arrive together from one answer, are never
-- queried across albums, and an answer that starts carrying a fifth thing
-- should not need a migration to keep it.
alter table public.hikes add column course_info jsonb;

comment on column public.hikes.course_info is
  '추천 코스가 말해준 것: { distanceText, durationText, difficulty, notes, sources }. '
  '경유지는 route_waypoints, 선은 track, 부원이 적는 글은 description.';
