-- Destructive OPTIONAL schema rollback: export memory first; disable the feature first.
-- No existing chat/user/wallet tables are modified.
drop table if exists user_memory_events;
drop table if exists user_memory_blocks;
drop table if exists user_memory_chats;
drop table if exists user_memories;
drop table if exists user_memory_settings;
