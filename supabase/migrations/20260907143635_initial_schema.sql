-- Phase 1: core schema — members, locations, hikes, hike_participants, photos.
-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- ── enums ────────────────────────────────────────────────────────────────

create type public.member_role as enum ('admin', 'member', 'pending');

create type public.photo_location_match_status as enum (
  'auto_matched',    -- EXIF GPS matched an existing location within 500m
  'manual_pending',  -- needs a human to pick/create a location
  'manual_matched',  -- filled in from the hike's location (no usable EXIF GPS)
  'no_gps'           -- EXIF had no usable GPS; not yet resolved to a location
);

-- ── tables ───────────────────────────────────────────────────────────────

create table public.members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null,
  role public.member_role not null default 'pending',
  avatar_url text,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision,
  lng double precision,
  region text,
  elevation integer,
  -- Nullable: keeps seeding/system-created locations simple and survives the
  -- creator's membership being removed.
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hikes (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: a hike can be created before its location is decided.
  location_id uuid references public.locations (id) on delete set null,
  date date not null,
  title text not null,
  description text,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hike_participants (
  hike_id uuid not null references public.hikes (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hike_id, member_id)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: photos can be uploaded before being assigned to a hike.
  hike_id uuid references public.hikes (id) on delete set null,
  uploader_id uuid not null references public.members (id) on delete restrict,
  storage_key_original text not null,
  taken_at timestamptz,
  exif_lat double precision,
  exif_lng double precision,
  location_match_status public.photo_location_match_status not null,
  matched_location_id uuid references public.locations (id) on delete set null,
  width integer,
  height integer,
  face_indexed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Phase 3 admin queue: "show me everything still needing a manual location match".
create index photos_location_match_status_idx on public.photos (location_match_status);
-- Phase 5 gallery pages list photos by hike; Phase 4 map pulls hikes by location.
create index photos_hike_id_idx on public.photos (hike_id);
create index hikes_location_id_idx on public.hikes (location_id);

-- ── updated_at trigger ───────────────────────────────────────────────────

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.members
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.hikes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.photos
  for each row execute function public.set_updated_at();

-- ── RLS helper functions ────────────────────────────────────────────────
-- security definer + owned by the migration role (postgres), which bypasses
-- its own RLS — this is what lets these read `members` without recursing
-- into the policies defined below.

create function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.members where auth_user_id = auth.uid();
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'admin' from public.members where auth_user_id = auth.uid()),
    false
  );
$$;

create function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('member', 'admin') from public.members where auth_user_id = auth.uid()),
    false
  );
$$;

-- Non-admins can update their own member row (Phase 2 profile edit) but not
-- promote themselves — role changes must go through an admin.
create function public.prevent_self_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'only an admin can change member role';
  end if;
  return new;
end;
$$;

create trigger prevent_self_role_change before update on public.members
  for each row execute function public.prevent_self_role_change();

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table public.members enable row level security;
alter table public.locations enable row level security;
alter table public.hikes enable row level security;
alter table public.hike_participants enable row level security;
alter table public.photos enable row level security;

-- members: everyone (including pending) can see/update their own row so the
-- "승인 대기 중" page and profile editing work pre-approval; admins see/edit all.
create policy members_select on public.members
  for select using (auth_user_id = auth.uid() or public.is_admin());

create policy members_update on public.members
  for update
  using (auth_user_id = auth.uid() or public.is_admin())
  with check (auth_user_id = auth.uid() or public.is_admin());

create policy members_delete on public.members
  for delete using (public.is_admin());

-- New member rows are created by the Phase 2 auth trigger (security definer,
-- bypasses RLS) or by an admin; no self-service insert policy is needed.
create policy members_insert on public.members
  for insert with check (public.is_admin());

-- locations / hikes: readable by any approved (non-pending) member;
-- writable by the creator or an admin.
create policy locations_select on public.locations
  for select using (public.is_approved_member());

create policy locations_insert on public.locations
  for insert with check (
    public.is_approved_member()
    and (created_by = public.current_member_id() or public.is_admin())
  );

create policy locations_update on public.locations
  for update
  using (created_by = public.current_member_id() or public.is_admin())
  with check (created_by = public.current_member_id() or public.is_admin());

create policy locations_delete on public.locations
  for delete using (created_by = public.current_member_id() or public.is_admin());

create policy hikes_select on public.hikes
  for select using (public.is_approved_member());

create policy hikes_insert on public.hikes
  for insert with check (
    public.is_approved_member()
    and (created_by = public.current_member_id() or public.is_admin())
  );

create policy hikes_update on public.hikes
  for update
  using (created_by = public.current_member_id() or public.is_admin())
  with check (created_by = public.current_member_id() or public.is_admin());

create policy hikes_delete on public.hikes
  for delete using (created_by = public.current_member_id() or public.is_admin());

-- hike_participants: readable by any approved member; a member can join/leave
-- themselves, and the hike's creator or an admin can manage the full roster.
create policy hike_participants_select on public.hike_participants
  for select using (public.is_approved_member());

create policy hike_participants_insert on public.hike_participants
  for insert with check (
    public.is_approved_member()
    and (
      member_id = public.current_member_id()
      or public.is_admin()
      or exists (
        select 1 from public.hikes h
        where h.id = hike_id and h.created_by = public.current_member_id()
      )
    )
  );

create policy hike_participants_delete on public.hike_participants
  for delete using (
    member_id = public.current_member_id()
    or public.is_admin()
    or exists (
      select 1 from public.hikes h
      where h.id = hike_id and h.created_by = public.current_member_id()
    )
  );

-- photos: readable by any approved member; writable by the uploader or an admin.
create policy photos_select on public.photos
  for select using (public.is_approved_member());

create policy photos_insert on public.photos
  for insert with check (
    public.is_approved_member()
    and (uploader_id = public.current_member_id() or public.is_admin())
  );

create policy photos_update on public.photos
  for update
  using (uploader_id = public.current_member_id() or public.is_admin())
  with check (uploader_id = public.current_member_id() or public.is_admin());

create policy photos_delete on public.photos
  for delete using (uploader_id = public.current_member_id() or public.is_admin());
