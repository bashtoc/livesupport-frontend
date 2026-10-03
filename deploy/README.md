# Contabo deployment

Target: Ubuntu 24.04 on `79.143.179.104` (IPv6 `2a02:c207:2363:601::1`).

This deploys only the React dashboard. Conversations remain local to each browser. Real staff authentication, shared storage, notifications, and durable chat require the independent backend before customer use.

## Access and initial inspection

Sign in to the Contabo customer panel. Verify the VPS identity and its SSH host-key fingerprint using the provider console before trusting the first SSH connection. Use an existing authorized key; do not commit passwords or private keys. Inspect the server, current services, ports, SSH configuration, and firewall before changing them. Preserve any existing sites.

## Provisioning order

1. Apply Ubuntu package/security updates and install Nginx.
2. Set up the authorized administrator's SSH public key and verify a second connection before changing SSH login settings. Keep the provider console as recovery access.
3. Allow the actual SSH port and HTTP/HTTPS in the firewall before enabling it. Restrict other inbound ports. Do not expose Vite's dev port, Redis, or PostgreSQL.
4. Deploy the frontend with the script below.
5. Review the `server_name` values in `nginx.conf` (currently `support.saference.com` and the VPS IP), save it in `/etc/nginx/sites-available/safer-support`, and enable its symlink in `sites-enabled`. Review default/conflicting sites before disabling any. Run `sudo nginx -t` before reloading.
6. Point the domain's A record to the IPv4 address. Add AAAA only after IPv6 routing and firewall access are tested.
7. Configure a valid TLS certificate for the chosen domain, redirect HTTP to HTTPS, and verify renewal. HTTP on the IP is for initial smoke checks, not private customer support.
8. Verify the public site, asset paths, SPA routing, service startup after reboot, and security headers. Record the deployed release and configuration changes.

## Release the frontend

From the project root, after provisioning Nginx and verifying SSH access:

```sh
./scripts/deploy-vps.sh your-admin-user@79.143.179.104
```

The script builds locally, uploads the bundle, retains releases, and atomically switches `/var/www/safer-support/current`. It preserves the former release in the `previous` symlink. It does not modify SSH settings, the firewall, DNS, or Nginx configuration.

## Roll back

Inspect the previous release first, then on the server:

```sh
sudo test -f /var/www/safer-support/previous/index.html
sudo ln -s "$(readlink -f /var/www/safer-support/previous)" /var/www/safer-support/current.rollback
sudo mv -Tf /var/www/safer-support/current.rollback /var/www/safer-support/current
```

Keep database and uploaded-file backups separate when adding the backend. A frontend release archive is not a backup of customer data.

## Current HTTPS configuration

The domain DNS record and certificate are installed, and renewal has passed a dry-run. `nginx.conf` is the initial HTTP bootstrap configuration; `nginx.production.conf` records the installed HTTPS site. Later frontend releases only switch the content symlink and retain the server’s HTTPS configuration. Certificate private keys remain on the VPS.
