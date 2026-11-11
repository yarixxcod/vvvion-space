-- Folders on the personal disk, and a short life for temporary megadisk files.

create table if not exists disk_folders (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists disk_folders_name_idx on disk_folders (user_id, name);

alter table disk_files add column if not exists folder_id text references disk_folders (id) on delete set null;

create index if not exists disk_files_folder_idx on disk_files (user_id, folder_id);

alter table mega_entries add column if not exists expires_at timestamptz;

create index if not exists mega_entries_expires_idx on mega_entries (expires_at) where expires_at is not null;
