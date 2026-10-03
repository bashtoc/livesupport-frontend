alter table staff_users
  add column invitation_status text check (invitation_status in ('queued', 'sent', 'failed')),
  add column invitation_queue_id uuid,
  add column invitation_last_error text;

create table email_outbox (
  id uuid primary key,
  staff_user_id uuid not null references staff_users(id) on delete cascade,
  kind text not null check (kind in ('staff_credentials')),
  recipient text not null,
  payload_ciphertext text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_delivery_idx
  on email_outbox(status, next_attempt_at, created_at)
  where status = 'queued';
