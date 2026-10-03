#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?Usage: scripts/deploy-backend-vps.sh user@host}"
case "$TARGET" in
  -*|*[!a-zA-Z0-9@._:-]*) printf 'Invalid SSH target\n' >&2; exit 1 ;;
esac

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$(mktemp -t safer-support-backend.XXXXXX.tgz)"
trap 'rm -f -- "$ARCHIVE"' EXIT

cd "$PROJECT_DIR/backend"
npm run lint
npm test
npm run build
COPYFILE_DISABLE=1 tar --no-xattrs \
  --exclude=node_modules --exclude=dist --exclude=.env --exclude=coverage \
  -czf "$ARCHIVE" .

scp -o StrictHostKeyChecking=yes "$ARCHIVE" "$TARGET:/tmp/safer-support-backend.tgz"
ssh -o StrictHostKeyChecking=yes "$TARGET" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
base=/opt/safer-support
archive=/tmp/safer-support-backend.tgz
test -f "$base/.env"
exec 9>"$base/.deploy.lock"
flock -x 9
tar --no-same-owner -xzf "$archive" -C "$base"
rm -f "$archive"
cd "$base"
docker compose config --quiet
docker compose up -d --build
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health/ready >/dev/null; then
    docker compose ps
    exit 0
  fi
  sleep 2
done
docker compose logs api --tail=100
exit 1
REMOTE
