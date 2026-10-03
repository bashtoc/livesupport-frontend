# Safer Support backend

The backend is an independent Node.js service for the Safer Support inbox. It persists ordered messages in PostgreSQL, distributes live events with Socket.IO and Redis, processes background jobs with BullMQ, and keeps attachments private in Cloudflare R2 until ClamAV approves them.

Staff onboarding uses a durable PostgreSQL email outbox and Cloudflare Email Sending. The API generates initial passwords server-side, encrypts queued credential payloads, and never returns the password to the dashboard.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for delivery receipts, push notifications, masking, SLA routing, CSAT, knowledge articles, reporting, metrics, and API redundancy.

## Services

- `api` and `api-secondary`: redundant Express and Socket.IO instances.
- `gateway`: internal Nginx load balancer published on loopback port 3000.
- `worker`: attachment scanning and notification jobs.
- `postgres`: durable customers, conversations, messages, sessions, and audit events.
- `redis`: Socket.IO fan-out and BullMQ queues.
- `clamav`: malware scanning for quarantined uploads.

The API is versioned under `/api/v1`. PostgreSQL, Redis, and ClamAV stay on a private Docker network. Only the API loopback port is published, for nginx to proxy.

## Local setup

1. Copy `.env.example` to `.env` and generate strong `POSTGRES_PASSWORD` and `SESSION_SECRET` values.
2. Generate an Ed25519 pair for the primary app. Put only the public key in `PRIMARY_APP_PUBLIC_KEY`; the private key belongs in the primary app's secret store.
3. Set the R2 values when attachment storage is available.
4. Start the stack:

```sh
docker compose up --build -d
docker compose exec api node dist/src/commands/bootstrap-admin.js
curl http://127.0.0.1:3000/api/v1/health/ready
```

For development outside Docker, set PostgreSQL and Redis URLs in `.env`, then run `npm run dev` and `npm run dev:worker` in separate terminals.

## Security choices

- Customers enter through one-use, short-lived Ed25519 assertions signed by the primary app.
- Staff use Argon2id passwords, optional TOTP MFA, rotating opaque refresh tokens, and role checks.
- Public replies and private notes are enforced server-side. Private note events go only to staff rooms.
- Client message IDs make retries idempotent. Message sequence numbers support HTTP replay after reconnect.
- Conversation changes require `expectedVersion`, preventing silent assignment and status races.
- Uploads pass through the authenticated API to an IP-restricted R2 credential. Objects remain quarantined until their size, content signature, MIME type, and malware scan pass; downloads use short-lived R2 URLs.
- Structured logs redact credentials, and material actions create audit records.
- Staff credentials are generated server-side, queued transactionally, sent through a narrowly scoped Cloudflare Email token with retry/backoff, and never logged or returned to the browser. Resending credentials rotates the password and revokes existing sessions.

See [Primary app integration](docs/PRIMARY_APP_INTEGRATION.md) and [API surface](docs/API.md).
