-- prevent_self_role_change blocked every role change where is_admin() was
-- false, including work done with the service role or from the SQL editor,
-- where auth.uid() is null. That left no way to appoint the first admin.
--
-- The guard is only meaningful against an end user acting through their own
-- session; anything holding the service role can already bypass RLS entirely,
-- so gating it on auth.uid() being present loses nothing.
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null
     and new.role is distinct from old.role
     and not public.is_admin() then
    raise exception 'only an admin can change member role';
  end if;
  return new;
end;
$$;
