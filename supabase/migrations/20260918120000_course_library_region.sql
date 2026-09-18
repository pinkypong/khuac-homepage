-- Where a course's mountain actually is, so two mountains with one name stay
-- two mountains.
--
-- 산림청 files 282 mountains that carry courses, and seventeen of those names
-- belong to more than one mountain: 계룡산 is the national park near 공주 and
-- also a hill in 거제, 가야산 is in 합천 and 서산 and 광양. The library is read
-- by name - `libraryFor` scores rows into a map keyed on `mountain` and then
-- takes every row with that name - so filing all of them would hand the
-- assistant three mountains' courses as if they were one mountain's list. It
-- would not be able to tell, and it would answer confidently and wrongly.
--
-- Not part of the unique key. Checked first: across all 505 courses the agency
-- describes, every (mountain, name) collision is between two courses on the
-- *same* mountain - none between different mountains of the same name - so
-- (mountain, name) still identifies a course, and leaving the key alone keeps
-- the existing 378 rows, whose region is null, upserting exactly as before.
--
-- Free text as the agency writes it, not a code. It writes 전남 in one row and
-- 전라남도 in the next, so whatever reads this has to fold the two; a code list
-- would have to be invented here and kept in step with them, and the only
-- question asked of this column - does the member's question name this place -
-- is answered as well by the words themselves.
alter table public.course_library add column region text;

comment on column public.course_library.region is
  '산이 있는 행정구역. 동명이산을 가르는 데 쓴다. 출처가 쓴 표기 그대로.';
