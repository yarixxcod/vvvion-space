-- Extend the existing media constraint atomically; retain all stored files and balances.
set local lock_timeout = '3s';
alter table disk_files add constraint disk_files_kind_agent_check check (kind in ('image', 'audio', 'file')) not valid;
alter table disk_files drop constraint disk_files_kind_check;
alter table disk_files validate constraint disk_files_kind_agent_check;
alter table disk_files rename constraint disk_files_kind_agent_check to disk_files_kind_check;
