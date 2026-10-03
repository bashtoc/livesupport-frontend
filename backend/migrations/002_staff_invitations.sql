alter table staff_users
  add column invitation_sent_at timestamptz,
  add column invitation_message_id text;
