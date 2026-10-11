#!/usr/bin/env bash
# Installs or updates Loggbok in WSL2 (Debian 13), next to a Heimdall that serves https://localhost.
# Loggbok is served at https://localhost:8443. Safe to re-run. From inside WSL:
#
#   sudo bash /mnt/c/Users/<you>/Claude/axis-suite/loggbok/deploy/install-wsl.sh
#
# Cookies ignore ports, so Heimdall's ordinary cookie for "localhost" also reaches
# localhost:8443 and Heimdall needs no COOKIE_DOMAIN here.
set -euo pipefail

SITE=localhost:8443
HEIMDALL_PUBLIC_URL=https://localhost
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "Please run as root (sudo)." >&2; exit 1; }
APP_USER="${SUDO_USER:-}"
[[ -n $APP_USER && $APP_USER != root ]] || { echo "Run this with sudo from your normal user, not as root." >&2; exit 1; }
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
APP_DIR="$APP_HOME/loggbok"
systemctl is-active --quiet heimdall || { echo "Heimdall isn't running. Install it first (see its README)." >&2; exit 1; }

# Windows' own node/pnpm are on the WSL PATH; always use the Linux ones.
NODE=/usr/bin/node
PNPM=/usr/bin/pnpm

# The suite's shared Node.js version lives one level up, in axis-suite/deploy/.
NODE_SH="$SRC_DIR/../deploy/node.sh"
[[ -f $NODE_SH ]] || { echo "Missing $NODE_SH. Copy the whole axis-suite folder, not just loggbok/." >&2; exit 1; }
# shellcheck source=../../deploy/node.sh
source "$NODE_SH"

echo "==> Packages"
apt-get update -q
apt-get install -y -q curl ca-certificates rsync

echo "==> Node.js $AXIS_NODE_MAJOR+ (shared by the whole suite; Loggbok needs node:sqlite)"
ensure_node

echo "==> pnpm"
[[ -x $PNPM ]] || npm install -g --no-audit --no-fund pnpm@11
echo "    pnpm $("$PNPM" --version)"

echo "==> Copying app to $APP_DIR and building (as $APP_USER)"
AS_USER=(sudo -u "$APP_USER" -H)
"${AS_USER[@]}" mkdir -p "$APP_DIR"
# Files on /mnt/c look world-writable to Linux; give the copy normal permissions.
"${AS_USER[@]}" rsync -a --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  --exclude node_modules --exclude dist --exclude .git --exclude 'server/notes.db*' \
  "$SRC_DIR/" "$APP_DIR/"
"${AS_USER[@]}" env -C "$APP_DIR" PATH="/usr/bin:/bin" "$PNPM" install --frozen-lockfile
"${AS_USER[@]}" env -C "$APP_DIR" PATH="/usr/bin:/bin" "$PNPM" build

echo "==> Installing loggbok systemd service"
cat > /etc/systemd/system/loggbok.service <<EOF
[Unit]
Description=Loggbok API
After=network.target heimdall.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE server/index.js
Restart=on-failure
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=HEIMDALL_INTERNAL_URL=http://127.0.0.1:3000
Environment=HEIMDALL_PUBLIC_URL=$HEIMDALL_PUBLIC_URL
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "==> Pointing Heimdall at Loggbok (drop-in; survives Heimdall reinstalls)"
mkdir -p /etc/systemd/system/heimdall.service.d
cat > /etc/systemd/system/heimdall.service.d/loggbok-wsl.conf <<EOF
# Written by loggbok/deploy/install-wsl.sh. In WSL both apps share the host "localhost",
# so the cookie needs no domain; https://$SITE may receive users after sign-in.
[Service]
Environment=COOKIE_DOMAIN=
Environment=RETURN_ORIGINS=https://$SITE
EOF

systemctl daemon-reload
systemctl enable loggbok >/dev/null
systemctl restart loggbok heimdall

echo "==> Caddy site https://$SITE"
# Caddy runs as "caddy" and must be able to reach dist/ inside the home directory.
chmod o+x "$APP_HOME"
mkdir -p /etc/caddy/sites.d
sed -e "s|^loggbok.gansoazul.com.br {|$SITE {|" \
    -e "s|/home/diogo/loggbok/dist|$APP_DIR/dist|" \
    "$APP_DIR/deploy/loggbok.caddy" > /etc/caddy/sites.d/loggbok.caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy

echo "==> Health check"
for _ in 1 2 3 4 5; do
  page=$(curl -sk -o /dev/null -w '%{http_code}' "https://$SITE/" || true)
  api=$(curl -sk -o /dev/null -w '%{http_code}' "https://$SITE/api/me" || true)
  if [[ $page == 200 && $api == 401 ]]; then
    echo "Loggbok is running. Open https://$SITE from Windows and sign in through Heimdall."
    exit 0
  fi
  sleep 1
done
echo "Loggbok did not respond as expected (page=$page, api=$api)." >&2
echo "Check: journalctl -u loggbok -n 50   and   journalctl -u caddy -n 50" >&2
exit 1
