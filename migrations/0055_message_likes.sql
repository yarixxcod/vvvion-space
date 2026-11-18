-- Additive message reactions. No wallet or existing message rewrites.
create table if not exists room_message_likes (
 message_id text not null references room_messages(id) on delete cascade,
 user_id text not null references "user"(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(message_id,user_id)
);
