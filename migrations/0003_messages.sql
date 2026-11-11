create table if not exists direct_messages (
  id text primary key,
  from_user_id text not null,
  to_user_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists dm_from_idx on direct_messages (from_user_id, created_at desc);
create index if not exists dm_to_idx on direct_messages (to_user_id, created_at desc);
