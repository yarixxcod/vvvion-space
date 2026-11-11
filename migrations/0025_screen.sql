-- Films an admin pins from YouTube, Rutube or VK.

create table if not exists screen_videos (
  id text primary key,
  added_by text not null references "user" (id) on delete cascade,
  provider text not null check (provider in ('youtube', 'rutube', 'vk')),
  external_id text not null,
  embed_url text not null,
  title text not null,
  thumb text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists screen_videos_ext_idx on screen_videos (provider, external_id);
