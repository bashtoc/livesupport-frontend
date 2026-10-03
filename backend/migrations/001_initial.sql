create extension if not exists pgcrypto;

create type staff_role as enum ('admin', 'supervisor', 'agent');
create type conversation_status as enum ('open', 'waiting', 'snoozed', 'resolved');
create type conversation_priority as enum ('low', 'normal', 'high', 'urgent');
create type message_kind as enum ('customer', 'agent', 'private_note', 'system');
create type attachment_status as enum ('pending_upload', 'quarantined', 'scanning', 'available', 'rejected', 'failed');

create table customers (
  id uuid primary key default gen_random_uuid(),
  external_uid text not null unique,
  verified_name text not null,
  email text,
  avatar_url text,
  account_status text not null default 'active',
  profile_version bigint not null default 1,
  last_assertion_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  password_hash text not null,
  role staff_role not null default 'agent',
  team text not null default 'customer-support',
  is_active boolean not null default true,
  mfa_secret_encrypted text,
  mfa_enabled boolean not null default false,
  session_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('customer', 'staff')),
  subject_id uuid not null,
  refresh_token_hash text not null unique,
  user_agent text,
  ip_address inet,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index auth_sessions_subject_idx on auth_sessions(subject_type, subject_id) where revoked_at is null;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  subject text not null,
  status conversation_status not null default 'open',
  priority conversation_priority not null default 'normal',
  team text not null default 'customer-support',
  assigned_staff_id uuid references staff_users(id),
  version bigint not null default 1,
  snoozed_until timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index conversations_customer_idx on conversations(customer_id, last_message_at desc);
create index conversations_queue_idx on conversations(status, assigned_staff_id, last_message_at desc);

create table labels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#2563eb',
  created_at timestamptz not null default now()
);

create table conversation_labels (
  conversation_id uuid not null references conversations(id) on delete cascade,
  label_id uuid not null references labels(id) on delete cascade,
  primary key (conversation_id, label_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sequence bigint generated always as identity,
  client_message_id text not null,
  kind message_kind not null,
  sender_customer_id uuid references customers(id),
  sender_staff_id uuid references staff_users(id),
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (conversation_id, client_message_id),
  unique (conversation_id, sequence),
  check (
    (kind = 'customer' and sender_customer_id is not null and sender_staff_id is null) or
    (kind in ('agent', 'private_note') and sender_staff_id is not null and sender_customer_id is null) or
    (kind = 'system' and sender_staff_id is null and sender_customer_id is null)
  )
);
create index messages_replay_idx on messages(conversation_id, sequence);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  uploaded_by_type text not null check (uploaded_by_type in ('customer', 'staff')),
  uploaded_by_id uuid not null,
  object_key text not null unique,
  original_name text not null,
  content_type text not null,
  byte_size integer not null,
  status attachment_status not null default 'pending_upload',
  scan_result text,
  sha256 text,
  created_at timestamptz not null default now(),
  scanned_at timestamptz
);
create index attachments_conversation_idx on attachments(conversation_id, created_at desc);

create table assignment_history (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  previous_staff_id uuid references staff_users(id),
  new_staff_id uuid references staff_users(id),
  changed_by_staff_id uuid not null references staff_users(id),
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('customer', 'staff', 'system')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  ip_address inet,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on audit_events(entity_type, entity_id, created_at desc);
create index audit_events_actor_idx on audit_events(actor_type, actor_id, created_at desc);

create table consumed_identity_assertions (
  jti text primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

create table notification_devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  token_ciphertext text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, platform, token_ciphertext)
);

create table saved_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  team text not null default 'customer-support',
  created_by uuid not null references staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_updated_at before update on customers for each row execute function set_updated_at();
create trigger staff_users_updated_at before update on staff_users for each row execute function set_updated_at();
create trigger conversations_updated_at before update on conversations for each row execute function set_updated_at();
create trigger notification_devices_updated_at before update on notification_devices for each row execute function set_updated_at();
create trigger saved_replies_updated_at before update on saved_replies for each row execute function set_updated_at();
