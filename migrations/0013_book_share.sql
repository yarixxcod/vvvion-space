-- Stable link so a shelf book can be opened in the reader. The token is the
-- capability. Removing the book removes the link. Same database as accounts.

alter table shelf_books add column if not exists share_token text;

create unique index if not exists shelf_books_share_token on shelf_books (share_token);
