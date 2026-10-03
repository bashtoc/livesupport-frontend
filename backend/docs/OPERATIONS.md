# Safer Support operations

## Delivery semantics

`Sent` means the API persisted a message. `Delivered` is recorded only when the recipient app or console acknowledges the exact message ID. `Read` is recorded when the recipient opens that conversation. Receipts can be sent over Socket.IO with `message:receipt` or with `POST /api/v1/conversations/:id/receipts`.

## Push notifications

Customer devices register with the support service at `PUT /api/v1/notifications/devices`. Tokens are encrypted at rest and indexed by a SHA-256 fingerprint. The queue sends privacy-safe notifications without message text through APNs or FCM. Configure `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY`, or `FCM_SERVICE_ACCOUNT_JSON` in the server `.env` to activate the respective provider.

## Routing and SLA

New conversations receive business-hour deadlines and are assigned to the least-loaded available agent by default. Supervisors can change the policy through `/api/v1/staff/operations/policy`, including timezone, opening hours, response and resolution targets, and `workload` or `round_robin` routing. The worker checks missed targets every 30 seconds, raises priority to urgent, records an SLA event, and publishes a realtime escalation.

## Monitoring and availability

Two API containers run behind the internal Nginx gateway. Socket.IO state is shared through Redis, and migration execution is guarded by a PostgreSQL advisory lock. Readiness checks include PostgreSQL and Redis. Prometheus metrics are available at `/api/v1/health/metrics` with `Authorization: Bearer $METRICS_TOKEN`.

This configuration tolerates one API-process failure. Host, PostgreSQL, and Redis failover require a second VPS or managed replicated services; the application layer is stateless and ready for that topology.

## Data protection

Potential account and card numbers from 10 to 19 digits are masked before message persistence. Attachments remain private in R2, must pass the malware scanner, and are downloaded through an authenticated endpoint.
