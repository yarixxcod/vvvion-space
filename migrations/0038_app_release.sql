-- Phone update published from the admin. Slot 1 and 2 let a new file replace the old one only after it is complete.

create table if not exists app_release (
  slot smallint primary key check (slot in (1, 2)),
  version_code integer not null,
  version_name text not null,
  file_name text not null,
  changelog text not null default '',
  force_update boolean not null default false,
  size integer not null,
  received integer not null default 0,
  next_idx integer not null default 0,
  ready boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists app_release_chunks (
  slot smallint not null,
  idx integer not null,
  data text not null,
  bytes integer not null,
  primary key (slot, idx)
);

create table if not exists app_release_pref (
  id smallint primary key default 1 check (id = 1),
  active_slot smallint,
  hide_builtin boolean not null default false,
  last_code integer not null default 0
);
