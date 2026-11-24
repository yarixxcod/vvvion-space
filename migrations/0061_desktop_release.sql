-- Windows desktop releases live beside the Android slots.
-- Installer bytes are not stored here: both platforms keep only metadata,
-- and the file pieces go to object storage.

alter table app_release add column if not exists storage text not null default 'db';

create table if not exists desktop_release (
  slot smallint primary key check (slot in (1, 2)),
  version_name text not null,
  file_name text not null,
  changelog text not null default '',
  signature text not null,
  platform text not null default 'windows-x86_64',
  size integer not null,
  received integer not null default 0,
  next_idx integer not null default 0,
  ready boolean not null default false,
  sha256 text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists desktop_release_pref (
  id smallint primary key default 1 check (id = 1),
  active_slot smallint,
  last_version text not null default ''
);

insert into desktop_release_pref (id) values (1) on conflict (id) do nothing;
