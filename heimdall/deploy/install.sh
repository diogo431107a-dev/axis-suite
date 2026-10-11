#!/usr/bin/env bash
# Installs or updates Heimdall on Debian 13 (trixie). Safe to re-run.
#
#   sudo bash deploy/install.sh heimdall.example.com   # real domain -> Let's Encrypt certificate
#   sudo bash deploy/install.sh 203.0.113.10           # bare IPv4   -> self-signed certificate
set -euo pipefail

SITE="${1:-}"
APP_DIR=/opt/heimdall
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "Please run as root (sudo)." >&2; exit 1; }
[[ -n $SITE ]] || { echo "Usage: sudo $0 <domain-or-ipv4>" >&2; exit 1; }

# The suite's shared Node.js version lives one level up, in axis-suite/deploy/.
NODE_SH="$SRC_DIR/../deploy/node.sh"
[[ -f $NODE_SH ]] || { echo "Missing $NODE_SH. Copy the whole axis-suite folder, not just heimdall/." >&2; exit 1; }
# shellcheck source=../../deploy/node.sh
source "$NODE_SH"

echo "==> Installing packages (caddy, rsync, curl)"
apt-get update -q
apt-get install -y -q caddy rsync curl ca-certificates

echo "==> Node.js $AXIS_NODE_MAJOR+ (shared by the whole suite)"
ensure_node

echo "==> Copying app to $APP_DIR and building"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude dist --exclude data --exclude .git "$SRC_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund

echo "==> Installing systemd service"
install -m 644 deploy/heimdall.service /etc/systemd/system/heimdall.service
systemctl daemon-reload
systemctl enable heimdall >/dev/null
systemctl restart heimdall

echo "==> Configuring Caddy for $SITE"
if [[ $SITE =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  ADDRESS="https://$SITE"
  TLS="tls internal"
else
  ADDRESS="$SITE"
  TLS=""
fi

CADDYFILE=/etc/caddy/Caddyfile
if [[ -f $CADDYFILE ]] && ! grep -q "Managed by Heimdall" "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
  echo "    Existing Caddyfile backed up next to it."
fi
mkdir -p /etc/caddy/sites.d
cat > "$CADDYFILE" <<EOF
# Managed by Heimdall's deploy/install.sh — this file is rewritten on every install.
# Put any other sites in /etc/caddy/sites.d/*.caddy; they are kept.
import /etc/caddy/sites.d/*.caddy

$ADDRESS {
	$TLS
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> Health check"
for _ in 1 2 3 4 5; do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
    echo "Heimdall is running. Open: https://$SITE"
    exit 0
  fi
  sleep 1
done
echo "Heimdall did not respond. Check: journalctl -u heimdall -n 50" >&2
exit 1
