update conversations c set
  first_response_at = coalesce(c.first_response_at, (select min(m.created_at) from messages m where m.conversation_id = c.id and m.kind = 'agent')),
  first_response_due_at = coalesce(c.first_response_due_at, c.created_at + interval '15 minutes'),
  resolution_due_at = coalesce(c.resolution_due_at, c.created_at + interval '8 hours'),
  last_customer_message_at = coalesce(c.last_customer_message_at, (select max(m.created_at) from messages m where m.conversation_id = c.id and m.kind = 'customer')),
  last_agent_message_at = coalesce(c.last_agent_message_at, (select max(m.created_at) from messages m where m.conversation_id = c.id and m.kind = 'agent'));

with author as (
  select id, team from staff_users where is_active order by
    case role when 'admin' then 0 when 'supervisor' then 1 else 2 end,
    created_at limit 1
), articles(title, slug, summary, body, category) as (values
  (
    'What should I do when a transfer is pending?',
    'pending-transfer',
    'How pending transfers are reviewed and when to contact support.',
    'A pending transfer is still being confirmed by the receiving bank or payment network. Do not repeat the transfer while it is pending. Check the transaction again after a few minutes. If the status does not change, open a support conversation and include the transaction date and reference. Never send your PIN, password, OTP, full card number, or complete account number in chat.',
    'Transfers'
  ),
  (
    'How reversed and failed transfers work',
    'failed-or-reversed-transfer',
    'What happens after a failed transfer and how reversals are tracked.',
    'A failed transfer normally returns to the source balance automatically. A reversed transfer has already been returned by the bank or payment network. Refresh your transaction history and balance before retrying. If the balance is still incorrect, contact support with the transaction reference and date. Safer Support will never ask for your PIN, password, or OTP.',
    'Transfers'
  ),
  (
    'Protect your account when contacting support',
    'protect-your-account',
    'Information Safer Support will never ask you to share.',
    'Safer Support will never ask for your password, transaction PIN, OTP, complete card number, CVV, or full account number. Sensitive number sequences sent in support chat are masked automatically, but you should still avoid sharing them. Use only the support option inside the Safer app or support.saference.com.',
    'Security'
  ),
  (
    'Why identity verification may be required',
    'identity-verification',
    'Why Safer verifies customers before account-sensitive assistance.',
    'Verification helps protect your account from unauthorized access. Complete verification only inside the Safer app. Support agents can see the verified profile supplied by the app, but they cannot see your password or PIN. If verification fails, confirm that your profile information is current and try again from a stable connection.',
    'Account'
  ),
  (
    'Sending a document or screenshot securely',
    'secure-attachments',
    'Supported attachment types and the malware scan process.',
    'You can attach a PNG, JPEG, PDF, or text file up to 10 MB. Every file is stored privately and scanned before it becomes available to the support team. Remove passwords, PINs, OTPs, full card numbers, CVVs, and complete account numbers before uploading a document.',
    'Support'
  )
)
insert into knowledge_articles(team, title, slug, summary, body, category, is_published, created_by, updated_by)
select author.team, articles.title, articles.slug, articles.summary, articles.body, articles.category, true, author.id, author.id
from author cross join articles
on conflict (slug) do nothing;
