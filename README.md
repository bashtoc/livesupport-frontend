# Safer Support

A React DOM + TypeScript dashboard for the independent Safer Support platform. Built with Vite and Lucide icons.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite. `npm run build` type-checks and produces the production bundle in `dist`. `npm run preview` previews that bundle.

## Implemented

- Responsive three-column inbox with charcoal navigation and a restrained blue accent.
- Staff sign-in with rotating API sessions and optional TOTP MFA.
- Live all, unassigned, mine, and team queues backed by PostgreSQL and Socket.IO.
- Server-backed public replies, private notes, assignments, priorities, statuses, customers, reports, and saved replies.
- Private Cloudflare R2 attachments with MIME validation, quarantine, ClamAV scanning, and authorized downloads.
- Administrator team management with server-generated credentials delivered through Cloudflare Email Sending.

## Backend

The structured production backend is in [`backend/`](backend/README.md). It includes Express, PostgreSQL, Redis, Socket.IO, BullMQ, private Cloudflare R2 attachment handling, ClamAV scanning, customer identity exchange, staff MFA and roles, optimistic conversation updates, message replay, and auditing.

The dashboard contains no seeded customer or conversation records. Customer conversations enter through the signed primary-app identity flow documented under `backend/docs`.

## Hosted dashboard

The frontend is deployed at [support.saference.com](https://support.saference.com/) on the independent Contabo VPS. See `deploy/STATUS.md` for server configuration and `scripts/deploy-vps.sh` for later releases. Hosting does not replace the backend integration requirements above.
