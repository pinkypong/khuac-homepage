-- Local dev / testing data. Runs after migrations on `supabase db reset`.
-- No member rows are seeded here (that requires a matching auth.users row,
-- which normally only exists once someone actually signs in) — created_by
-- is nullable for exactly this reason, so locations/hikes can be seeded
-- without one.

insert into public.locations (id, name, lat, lng, region, elevation) values
  ('00000000-0000-0000-0000-000000000001', '북한산 백운대', 37.6585, 126.9772, '서울', 836),
  ('00000000-0000-0000-0000-000000000002', '지리산 천왕봉', 35.3372, 127.7306, '경남/전남', 1915),
  ('00000000-0000-0000-0000-000000000003', '설악산 대청봉', 38.1197, 128.4656, '강원', 1708);

insert into public.hikes (id, location_id, date, title, description) values
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    current_date - 7,
    '북한산 정기 산행',
    '시드 데이터용 테스트 산행'
  );
