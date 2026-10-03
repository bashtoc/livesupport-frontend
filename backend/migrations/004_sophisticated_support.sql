alter table conversations
  add column first_response_due_at timestamptz,
  add column resolution_due_at timestamptz,
  add column first_response_at timestamptz,
  add column sla_breached_at timestamptz,
  add column last_customer_message_at timestamptz,
  add column last_agent_message_at timestamptz,
  add column reopened_count integer not null default 0;

alter table staff_users
  add column availability_status text not null default 'available'
    check (availability_status in ('available', 'busy', 'offline')),
  add column last_assigned_at timestamptz;

alter table assignment_history
  alter column changed_by_staff_id drop not null,
  add column reason text not null default 'manual';

alter table notification_devices
  add column provider text not null default 'apns' check (provider in ('apns', 'fcm')),
  add column environment text not null default 'production' check (environment in ('development', 'production')),
  add column token_hash text;

update notification_devices set token_hash = encode(digest(token_ciphertext, 'sha256'), 'hex') where token_hash is null;
alter table notification_devices alter column token_hash set not null;
create unique index notification_devices_token_idx on notification_devices(customer_id, provider, token_hash);

create table message_receipts (
  message_id uuid not null references messages(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('customer', 'staff')),
  recipient_id uuid not null,
  delivered_at timestamptz,
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (message_id, recipient_type, recipient_id),
  check (read_at is null or delivered_at is not null)
);
create index message_receipts_recipient_idx on message_receipts(recipient_type, recipient_id, updated_at desc);

create table support_policies (
  team text primary key,
  timezone text not null default 'Africa/Lagos',
  business_days smallint[] not null default '{1,2,3,4,5}',
  business_open time not null default '08:00',
  business_close time not null default '18:00',
  first_response_minutes integer not null default 15 check (first_response_minutes between 1 and 10080),
  resolution_minutes integer not null default 480 check (resolution_minutes between 1 and 43200),
  assignment_mode text not null default 'workload' check (assignment_mode in ('workload', 'round_robin')),
  updated_at timestamptz not null default now()
);
insert into support_policies(team) values ('customer-support') on conflict do nothing;

create table sla_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  event_type text not null check (event_type in ('first_response_missed', 'resolution_missed')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(conversation_id, event_type)
);

create table conversation_feedback (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  team text not null default 'customer-support',
  title text not null,
  slug text not null unique,
  summary text not null default '',
  body text not null,
  category text not null default 'General',
  is_published boolean not null default false,
  created_by uuid not null references staff_users(id),
  updated_by uuid not null references staff_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_articles_team_idx on knowledge_articles(team, is_published, updated_at desc);

create trigger support_policies_updated_at before update on support_policies for each row execute function set_updated_at();
create trigger conversation_feedback_updated_at before update on conversation_feedback for each row execute function set_updated_at();
create trigger knowledge_articles_updated_at before update on knowledge_articles for each row execute function set_updated_at();

create index conversations_sla_idx on conversations(status, first_response_due_at, resolution_due_at)
  where status <> 'resolved';
