-- Shared shelf. A signed-in person can publish a book; everyone signed in can read it.

create table if not exists shelf_books (
  id text primary key,
  owner_id text not null references "user" (id) on delete cascade,
  title text not null,
  author text not null default '',
  language text not null default '',
  format text not null,
  cover text not null default '',
  file_name text not null default '',
  words integer not null default 0,
  chapters integer not null default 0,
  added_at timestamptz not null default now()
);

create index if not exists shelf_books_added on shelf_books (added_at desc);

create table if not exists shelf_files (
  book_id text primary key references shelf_books (id) on delete cascade,
  payload text not null
);

create table if not exists shelf_progress (
  user_id text not null references "user" (id) on delete cascade,
  book_id text not null references shelf_books (id) on delete cascade,
  chapter integer not null default 0,
  ratio double precision not null default 0,
  opened_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
