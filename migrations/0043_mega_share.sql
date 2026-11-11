-- Public view-and-download links for one Megadisk file or folder.
-- The token is the capability. Deleting the entry deletes the link.

create table if not exists mega_shares (
  token text primary key,
  user_id text not null references "user" (id) on delete cascade,
  entry_id text not null references mega_entries (id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists mega_shares_entry_idx on mega_shares (entry_id);
