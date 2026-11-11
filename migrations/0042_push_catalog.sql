alter table push_settings add column if not exists money boolean not null default true;
alter table push_settings add column if not exists security boolean not null default true;
alter table push_settings add column if not exists system boolean not null default false;
alter table push_settings add column if not exists quiet_from smallint not null default 23;
alter table push_settings add column if not exists quiet_to smallint not null default 8;

create table if not exists daily_tips (
  id integer primary key,
  model text not null default '',
  items jsonb not null,
  created_at timestamptz not null default now()
);
