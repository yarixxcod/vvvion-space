-- VVVion Memory: additive only. Apply explicitly after approval, never from request handlers.
create table if not exists user_memory_settings (
 user_id text primary key references "user"(id) on delete cascade,
 enabled boolean not null default false,
 automatic boolean not null default false,
 generation integer not null default 0,
 updated_at timestamptz not null default now(),
 check(not automatic or enabled)
);
create table if not exists user_memories (
 id text primary key,
 user_id text not null references "user"(id) on delete cascade,
 content text not null check(char_length(content) between 3 and 500),
 category text not null check(category in ('about','interests','preferences','projects','goals','other')),
 fingerprint text not null,
 slot text not null default '',
 source_type text not null check(source_type in ('manual','command','automatic','legacy')),
 confidence real not null check(confidence between 0 and 1),
 importance smallint not null check(importance between 1 and 10),
 status text not null default 'active' check(status in ('active','conflict')),
 sensitive boolean not null default false,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_used_at timestamptz,
 expires_at timestamptz,
 unique(user_id,fingerprint)
);
create unique index if not exists user_memories_active_slot on user_memories(user_id,slot)
 where status='active' and slot<>'';
create index if not exists user_memories_owner on user_memories(user_id,status,importance desc);
create table if not exists user_memory_chats (
 user_id text not null references "user"(id) on delete cascade,
 chat_key text not null,
 disabled boolean not null default false,
 primary key(user_id,chat_key)
);
create table if not exists user_memory_blocks (
 user_id text not null references "user"(id) on delete cascade,
 fingerprint text not null,
 primary key(user_id,fingerprint)
);
create table if not exists user_memory_events (
 id text primary key,
 user_id text not null references "user"(id) on delete cascade,
 operation text not null,
 outcome text not null,
 duration_ms integer not null default 0,
 facts integer not null default 0,
 ai_calls integer not null default 0,
 cost_usd numeric(12,6) not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists user_memory_events_owner on user_memory_events(user_id,created_at desc);
