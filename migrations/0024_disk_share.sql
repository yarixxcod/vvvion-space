-- One public view-link per disk.

create table if not exists disk_shares (
  user_id text primary key references "user" (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
