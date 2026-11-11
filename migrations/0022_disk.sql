-- Personal disk for generated pictures and voice notes.

create table if not exists disk_accounts (
  user_id text primary key references "user" (id) on delete cascade,
  bonus_bytes integer not null default 0
);

create table if not exists disk_files (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  mime text not null,
  bytes integer not null,
  kind text not null check (kind in ('image', 'audio')),
  data text not null,
  created_at timestamptz not null default now()
);

create index if not exists disk_files_user_idx on disk_files (user_id, created_at desc);
