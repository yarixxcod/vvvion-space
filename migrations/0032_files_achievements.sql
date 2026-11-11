-- Uploaded files live in the database. The server disk on vvvion.space is read-only.

create table if not exists file_uploads (
  id text primary key,
  user_id text not null,
  room_id text not null,
  name text not null,
  mime text not null,
  size integer not null,
  received integer not null default 0,
  next_idx integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists file_chunks (
  id text not null,
  idx integer not null,
  data text not null,
  primary key (id, idx)
);

create table if not exists achievements (
  user_id text not null references "user" (id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);
