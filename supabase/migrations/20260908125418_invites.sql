-- Invite links: admins share a `/join/<token>` URL (KakaoTalk, Band, ...).
-- Signing up through it still lands the member in the normal 'pending'
-- queue - this only records which link brought them in so an admin has
-- context when approving. Tokens are generated app-side
-- (crypto.randomUUID()), not by a Postgres default, so no pgcrypto
-- extension is needed.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  label text,
  created_by uuid references public.members (id) on delete set null,
  -- null = unlimited uses
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.members
  add column invited_via uuid references public.invites (id) on delete set null;

alter table public.invites enable row level security;

create policy invites_select on public.invites
  for select using (public.is_admin());

create policy invites_insert on public.invites
  for insert with check (
    public.is_admin() and (created_by = public.current_member_id() or created_by is null)
  );

create policy invites_update on public.invites
  for update using (public.is_admin()) with check (public.is_admin());

-- Validates a token and reports just enough to render the /join/<token> page
-- (no row data) - safe to expose to signed-out visitors.
create function public.check_invite(p_token text)
returns table (valid boolean, label text)
language sql
stable
security definer
set search_path = public
as $$
  select
    (i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
      and (i.max_uses is null or i.used_count < i.max_uses)) as valid,
    i.label
  from public.invites i
  where i.token = p_token;
$$;

revoke all on function public.check_invite(text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;

-- Called right after sign-in when a ?invite=<token> was carried through the
-- OAuth/magic-link redirect. Locks the invite row so two concurrent
-- redemptions of a max_uses-limited link can't both slip past the check.
-- Any failure (bad/expired/exhausted token) is meant to be caught and
-- ignored by the caller - it must never block a normal sign-in.
create function public.consume_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites%rowtype;
  v_member_id uuid;
begin
  select id into v_member_id from public.members where auth_user_id = auth.uid();
  if v_member_id is null then
    raise exception 'no member row for current user';
  end if;

  select * into v_invite from public.invites where token = p_token for update;
  if not found then
    raise exception 'invalid invite token';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite expired';
  end if;
  if v_invite.max_uses is not null and v_invite.used_count >= v_invite.max_uses then
    raise exception 'invite already used';
  end if;

  update public.members set invited_via = v_invite.id where id = v_member_id;
  update public.invites set used_count = used_count + 1 where id = v_invite.id;
end;
$$;

revoke all on function public.consume_invite(text) from public;
grant execute on function public.consume_invite(text) to authenticated;
