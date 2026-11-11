-- First credential signup becomes the single admin. Bans and the shared model list live here.

create table if not exists members (
  user_id text primary key references "user" (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  banned_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists members_one_admin on members (role) where role = 'admin';

create table if not exists member_guard (
  id integer primary key
);

insert into member_guard (id) values (1) on conflict do nothing;

create table if not exists catalog_models (
  name text primary key,
  created_at timestamptz not null default now()
);

insert into catalog_models (name) values
  ('grok-4.5'),
  ('grok-4.6'),
  ('grok-4.7'),
  ('grok-4.3')
on conflict do nothing;

create or replace function ensure_member(uid text)
returns table (out_role text, is_banned boolean)
language plpgsql
as $fn$
declare
  existing_role text;
  existing_ban timestamptz;
  first_id text;
  next_role text;
begin
  perform 1 from member_guard where id = 1 for update;

  if not exists (select 1 from "user" u where u.id = uid) then
    raise exception 'Пользователь не найден';
  end if;

  select u.id into first_id
  from "user" u
  join "account" a on a."userId" = u.id and a."providerId" = 'credential'
  order by u."createdAt" asc, u.id asc
  limit 1;

  select m.role, m.banned_at
    into existing_role, existing_ban
  from members m
  where m.user_id = uid;

  if found then
    if existing_role <> 'admin'
       and uid = first_id
       and not exists (select 1 from members where role = 'admin') then
      update members set role = 'admin' where user_id = uid;
      existing_role := 'admin';
    end if;
    out_role := existing_role;
    is_banned := existing_ban is not null;
    return next;
    return;
  end if;

  if uid = first_id and not exists (select 1 from members where role = 'admin') then
    next_role := 'admin';
  else
    next_role := 'member';
  end if;

  insert into members (user_id, role) values (uid, next_role);
  out_role := next_role;
  is_banned := false;
  return next;
end;
$fn$;
