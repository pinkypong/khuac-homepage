-- Phase 2: auto-create a pending members row whenever someone signs up via
-- Supabase Auth (Google OAuth or email magic link).
--
-- A DB trigger (rather than an Auth Webhook) was chosen because it runs in
-- the same transaction as the auth.users insert: there's no window where a
-- user is authenticated but has no members row because a webhook call
-- failed or timed out.

alter table public.members add column email text;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.members (auth_user_id, name, email, avatar_url, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    'pending'
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
