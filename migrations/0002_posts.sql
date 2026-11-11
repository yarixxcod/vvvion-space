create table if not exists posts (
  id text primary key,
  user_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_idx on posts (created_at desc);
create index if not exists posts_user_idx on posts (user_id);

create table if not exists post_likes (
  post_id text not null references posts (id) on delete cascade,
  user_id text not null,
  primary key (post_id, user_id)
);
