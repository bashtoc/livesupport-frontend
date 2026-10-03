#!/usr/bin/env bash
set -euo pipefail

# Use a verified SSH host key and existing SSH credentials. No secrets in this script.
TARGET="${1:?Usage: scripts/deploy-vps.sh user@host}"
case "$TARGET" in
  -*|*[!a-zA-Z0-9@._:-]*) printf 'Invalid SSH target\n' >&2; exit 1 ;;
esac
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

cd "$PROJECT_DIR"
npm run build
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$TEMP_DIR/$RELEASE.tar.gz" -C dist .
scp -o StrictHostKeyChecking=yes "$TEMP_DIR/$RELEASE.tar.gz" "$TARGET:/tmp/safer-$RELEASE.tar.gz"
ssh -o StrictHostKeyChecking=yes "$TARGET" "sudo bash -s -- '$RELEASE'" <<'REMOTE'
set -euo pipefail
release="$1"
base=/var/www/safer-support
archive="/tmp/safer-$release.tar.gz"
install -d -m 755 "$base"
exec 9>"$base/.deploy.lock"
flock -x 9
install -d -m 755 "$base/releases/$release"
tar --no-same-owner -xzf "$archive" -C "$base/releases/$release"
chown -R root:root "$base/releases/$release"
find "$base/releases/$release" -type d -exec chmod 755 {} +
find "$base/releases/$release" -type f -exec chmod 644 {} +
test -f "$base/releases/$release/index.html"
if [ -L "$base/current" ]; then
  previous="$(readlink -f "$base/current")"
  ln -sfn "$previous" "$base/previous"
fi
ln -s "$base/releases/$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
rm -f "$archive"
printf 'Published release: %s\n' "$release"
REMOTE
