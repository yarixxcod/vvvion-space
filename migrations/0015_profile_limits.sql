-- Profile photos and the admin's daily chat limits.

create table if not exists profile_avatars (
  user_id text primary key references "user" (id) on delete cascade,
  mime text not null,
  data text not null,
  updated_at timestamptz not null default now()
);

alter table chat_attempts add column if not exists total_tokens integer not null default 0;

create table if not exists usage_policy (
  id integer primary key,
  daily_requests integer,
  daily_tokens integer
);

insert into usage_policy (id, daily_requests, daily_tokens)
values (1, null, null)
on conflict (id) do nothing;
