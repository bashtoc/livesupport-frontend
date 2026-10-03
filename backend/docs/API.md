# API surface

All JSON endpoints are under `/api/v1`. Protected routes require `Authorization: Bearer <accessToken>`.

## Identity and sessions

- `POST /identity/exchange` — exchange a one-use primary-app assertion for a customer session.
- `POST /auth/staff/login` — staff password and optional six-digit TOTP.
- `POST /auth/refresh` — rotate a refresh token and issue a new access token.
- `POST /auth/logout` — revoke a refresh token.
- `POST /auth/staff/mfa/setup` and `/mfa/confirm` — enroll staff TOTP.

## Conversations and messages

- `GET|POST /customer/conversations` — list or create the authenticated customer's conversations.
- `GET /staff/conversations` — list a team queue with `view`, `status`, `search`, and cursor filters.
- `PATCH /staff/conversations/{id}` — assign, prioritize, snooze, or resolve using `expectedVersion`.
- `GET /conversations/{id}/messages?after=0&limit=50` — ordered replay.
- `POST /conversations/{id}/messages` — send a public reply or staff-only private note. `clientMessageId` is required for idempotency.

## Attachments

1. `POST /conversations/{id}/attachments/initiate` with file name, MIME type, and byte size.
2. `PUT` the raw file body to the returned authenticated API URL using the exact content type. The API validates the bytes and streams the object into private R2 storage from the IP-restricted VPS.
3. `POST /conversations/{id}/attachments/{attachmentId}/complete` to quarantine and scan.
4. Reference the available attachment ID when sending a message.
5. `GET /conversations/{id}/attachments/{attachmentId}/download` streams the authorized object through the API.

Allowed types are PNG, JPEG, PDF, and plain text. The default maximum is 10 MiB.

## Staff tools

- `GET /staff/users` — list visible support staff.
- `POST /staff/users` — create a staff account. The server generates an initial password and atomically writes an encrypted credentials job to the PostgreSQL email outbox.
- `POST /staff/users/{id}/resend-credentials` — generate a new password, revoke existing sessions, and queue new login credentials.
- `PATCH /staff/users/{id}` — update role, team, or active state.
- `GET|POST|PATCH|DELETE /staff/saved-replies` — team-scoped reply library.
- `GET /staff/audit/{conversationId}` — conversation audit trail for supervisors/admins.

## Realtime events

Connect Socket.IO at `/socket.io` with `{ auth: { token } }`, then emit `conversation:join` with the conversation UUID. The server emits `message:created`, staff-only `message:private-note`, `conversation:created`, `conversation:updated`, and `attachment:available`.

REST is authoritative. Socket events are hints for immediate updates; sequence replay repairs any gaps.

## Email delivery

The worker claims credential jobs from the PostgreSQL outbox with `FOR UPDATE SKIP LOCKED`, sends them through Cloudflare Email Sending, and records provider delivery IDs. Failed requests retry up to five times with exponential backoff. Credential payloads are AES-256-GCM encrypted while queued and erased after successful delivery.
