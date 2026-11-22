-- Ревизия памяти. Текст фактов сюда не пишется: он лежит в приватном объекте.
-- Строка нужна, чтобы одновременные сохранения одного человека шли по очереди.

create table if not exists memory_objects (
  user_id text primary key,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
