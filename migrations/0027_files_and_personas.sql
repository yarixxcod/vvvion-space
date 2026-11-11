-- Circle attachments may live on disk (up to 250 MB). Paid chat personas.

alter table room_files add column if not exists blob_path text;

create table if not exists owned_personas (
  user_id text not null references "user" (id) on delete cascade,
  persona_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, persona_id)
);

create table if not exists active_persona (
  user_id text primary key references "user" (id) on delete cascade,
  persona_id text not null
);
