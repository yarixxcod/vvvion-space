-- Interests chosen at first signup. They only shape quick questions in a new chat.

create table if not exists user_interests (
  user_id text primary key references "user" (id) on delete cascade,
  topics text not null default '',
  tone text not null default '',
  skipped boolean not null default false,
  updated_at timestamptz not null default now()
);
