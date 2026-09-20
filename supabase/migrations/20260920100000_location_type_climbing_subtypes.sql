-- Two more kinds of place a location can be: a multi-pitch crag and a
-- hard-free crag, alongside the mountain/gym/outdoor-wall it already had.
--
-- 산/실내 클라이밍짐/실외 암장 read as three unrelated kinds of ground. The
-- club's own activity vocabulary (워킹/실내암장/외벽/암벽등반, see activity.ts)
-- already spells out the real distinction better - walking versus rock, indoor
-- versus out, artificial versus real - and a location's own type is being
-- brought into line with it: mountain becomes 워킹's home, crag becomes 외벽's
-- (an artificial outdoor wall, 뚝섬 and the like), and multi_pitch/hard_free
-- are new because natural rock was not a location type at all before - only
-- an activity a hike under a mountain could carry.
--
-- Additive only. Nothing reads location_type for anything but a label today
-- (checked: it drives no marker colour, no search bias, no other branch), so
-- extending the enum costs nothing already relying on its being three values.
alter type public.location_type add value 'multi_pitch';
alter type public.location_type add value 'hard_free';
