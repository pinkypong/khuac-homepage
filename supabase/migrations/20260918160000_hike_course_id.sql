-- Which library course an album was made from.
--
-- An album built from a suggested course already keeps what the course said
-- (course_info) and where it goes (route_waypoints, track), but not which
-- course it was. So nothing can be asked in either direction: a member opening
-- 북한산 숨은벽 cannot see that three seniors have already walked it, and a
-- course whose distance we later measure against a real GPX has no way to find
-- the albums that would supply the GPX.
--
-- Nullable because most albums have no course behind them - a member pinning a
-- walk they just did is the common case, and it is not a lesser album for it.
--
-- on delete set null rather than cascade: deleting a course from the library
-- must never delete a member's photos. The album is the member's; the course
-- is only how they found it.
alter table public.hikes
  add column course_id uuid references public.course_library (id) on delete set null;

-- Partial: the question is always "which albums walked this course", never
-- "which albums have no course", and most rows are the latter.
create index hikes_course_id_idx on public.hikes (course_id) where course_id is not null;

comment on column public.hikes.course_id is
  '이 앨범을 만든 근거가 된 course_library 코스. 같은 코스를 걸은 앨범을 서로 찾기 위한 것. '
  '앨범 대부분은 코스 없이 만들어지므로 null이 정상이다.';
