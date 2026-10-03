# Backup and restore

The VPS runs `safer-support-backup.timer` daily at 03:30 Africa/Lagos. It streams a PostgreSQL custom-format dump into a client-side encrypted Restic repository under `database-backups/` in the private `safer-support-private` R2 bucket.

Retention keeps 7 daily, 4 weekly, and 6 monthly snapshots. Repository credentials and the encryption password are stored root-only at `/root/.config/safer-support-backup.env`; losing that file makes the encrypted backups unrecoverable. Keep a separate protected copy in the organization's secret manager.

## Verify

```sh
sudo systemctl start safer-support-backup.service
sudo systemctl status safer-support-backup.service
sudo bash -c 'set -a; source /root/.config/safer-support-backup.env; set +a; restic check'
```

## Restore into a temporary database

Run this before any production replacement:

```sh
cd /opt/safer-support
docker compose exec -T postgres createdb -U safer_support safer_support_restore_test
sudo bash -c 'set -a; source /root/.config/safer-support-backup.env; set +a; restic dump latest safer_support.dump' \
  | docker compose exec -T postgres pg_restore -U safer_support -d safer_support_restore_test --clean --if-exists
docker compose exec -T postgres psql -U safer_support -d safer_support_restore_test -c 'select count(*) from schema_migrations'
```

Inspect the restored database before planning a production cutover. Dropping or replacing a production database is intentionally outside this runbook's automatic steps.
