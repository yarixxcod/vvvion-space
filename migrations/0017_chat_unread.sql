-- A reply can finish after the visitor leaves. unread marks that chat until they open it.
alter table saved_chats add column if not exists unread boolean not null default false;

-- Built-in image models the admin can add. The last row cannot be removed.
create table if not exists image_models (
  name text primary key,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

insert into image_models (name, display_name)
values ('grok-imagine-image', 'Grok Imagine')
on conflict (name) do nothing;
