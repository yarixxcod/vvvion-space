-- Photos, video and files on feed posts, plus an unguessable share link.

create table if not exists post_files (
  id text primary key,
  post_id text not null references posts (id) on delete cascade,
  user_id text not null,
  name text not null,
  mime text not null,
  size integer not null,
  kind text not null check (kind in ('image', 'video', 'file')),
  data text not null,
  created_at timestamptz not null default now()
);

create index if not exists post_files_post_idx on post_files (post_id, created_at);

create table if not exists post_shares (
  post_id text primary key references posts (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
