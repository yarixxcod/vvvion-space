-- Friends, rooms, and file messages for the Circle messenger.

create table if not exists friend_links (
  from_id text not null,
  to_id text not null,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (from_id, to_id)
);

create index if not exists friend_to_idx on friend_links (to_id, status);

create table if not exists rooms (
  id text primary key,
  kind text not null check (kind in ('dm', 'group')),
  title text,
  dm_key text unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists room_members (
  room_id text not null references rooms (id) on delete cascade,
  user_id text not null,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on room_members (user_id);

create table if not exists room_messages (
  id text primary key,
  room_id text not null references rooms (id) on delete cascade,
  user_id text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists room_messages_room_idx on room_messages (room_id, created_at);

create table if not exists room_files (
  id text primary key,
  room_id text not null references rooms (id) on delete cascade,
  message_id text not null references room_messages (id) on delete cascade,
  user_id text not null,
  name text not null,
  mime text not null,
  size integer not null,
  data text not null,
  created_at timestamptz not null default now()
);

create index if not exists room_files_message_idx on room_files (message_id);
