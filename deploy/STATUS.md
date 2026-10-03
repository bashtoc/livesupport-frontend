# Deployment status

- Server: `vmi3630601`, Contabo, Ubuntu 24.04 LTS.
- IPv4: `79.143.179.104`.
- Intended hostname: `support.saference.com`.
- DNS provider: Cloudflare; DNS-only A record `support` → `79.143.179.104` verified at the authoritative server and public resolver.
- Frontend release: `20261002T225123Z-fb80dedd`.
- Published directory: `/var/www/safer-support/current`.
- Release directory: `/var/www/safer-support/releases/20261002T225123Z-fb80dedd`.
- Nginx site: `/etc/nginx/sites-available/safer-support`.
- Backend directory: `/opt/safer-support`; Docker Compose services bind the API only to `127.0.0.1:3000`.
- API: `https://support.saference.com/api/v1`; realtime transport: `https://support.saference.com/socket.io`.
- Site: `https://support.saference.com/`, verified 200 OK with a valid TLS certificate. HTTP redirects to HTTPS. SPA fallback and logo match local build files; the HTTP preview reply composer was also tested.
- Nginx, SSH, and Fail2ban: active and enabled at startup; verified after reboot.
- SSH: existing authorized public key tested; password and keyboard-interactive login disabled; root login allowed by key only.
- Firewall: default deny incoming; TCP 22, 80, and 443 allowed for IPv4 and IPv6.
- Automated Ubuntu security updates: enabled.
- Certbot: domain certificate installed, expires December 31, 2026; renewal timer enabled. Renewal dry-run succeeded; automatic renewal is enabled.
- Initial SSH/Nginx configuration backup: `/root/safer-provision-backup`.

## Verification

- HTTPS verified with normal certificate validation.
- Public DNS and HTTPS browser rendering verified, with no browser console errors.
- Certificate renewal simulation passed using `certbot renew --dry-run --no-random-sleep-on-renew`.
- The certificate account has no contact email; renewal service logs are available through Certbot and systemd.
- Production Nginx configuration recorded in `nginx.production.conf` (contains paths, no private keys).
- Public API readiness and Socket.IO polling handshake verified through nginx and TLS.
- Docker API, PostgreSQL, Redis, ClamAV, and worker services verified healthy/running.
- Cloudflare R2 bucket `safer-support-private` created with public access disabled and Standard storage.
- R2 API access is limited to Object Read & Write on that bucket and restricted to the VPS public IPv4 and IPv6 addresses.
- Attachment flow verified through identity exchange, authenticated API upload, byte/type validation, R2 persistence, ClamAV scan, authorized download, and message association.
- The bucket CORS policy is restricted to `https://support.saference.com`; public and development URLs remain disabled.
- PostgreSQL is backed up daily at 03:30 Africa/Lagos to an encrypted Restic repository in private R2 storage. Retention is 7 daily, 4 weekly, and 6 monthly snapshots; the initial archive and repository check passed.


## Product scope

The dashboard uses the production backend under `/api/v1` for staff authentication, customer and conversation data, team management, and live messaging. PostgreSQL, Redis, Socket.IO, BullMQ, ClamAV, Cloudflare Email Sending, and private R2 attachment storage are deployed. New customer conversations enter through the signed primary-app identity exchange documented in `backend/docs/PRIMARY_APP_INTEGRATION.md`.

Use `scripts/deploy-vps.sh` for frontend releases and `scripts/deploy-backend-vps.sh` for backend releases. Keep credentials and private keys outside this repository.
