-- Same reasoning as 20260926090000_public_read_locations_hikes.sql: no
-- personal data here, only mountain/course/route text, and it is what lets a
-- location be found by a course inside it (숨은암장 for 삼성산) even from the
-- read-only map, not only once a member is signed in.
--
-- course_library_write stays approved-member-only, unchanged - this only
-- opens select.
drop policy course_library_select on public.course_library;
create policy course_library_select on public.course_library
  for select using (true);

comment on policy course_library_select on public.course_library is
  'Public read - see this migration''s header for why.';
