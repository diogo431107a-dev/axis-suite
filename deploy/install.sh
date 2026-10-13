#!/usr/bin/env bash
# Installs or updates one module of the Axis Suite on Debian 13 (trixie). Safe to re-run.
#
#   sudo bash deploy/install.sh <module> [domain]
#
# The first run on a server needs the domain; later runs reuse it from /etc/axis-suite/suite.env.
# The domain decides where every module is served:
#   example.com     https://<module>.example.com, with Let's Encrypt certificates (needs DNS)
#   localhost       https://localhost:<local_port>, signed by Caddy's local CA (WSL)
#   203.0.113.10    https://203.0.113.10:<local_port>, self-signed
# Ports come from deploy/modules.conf.
#
# A module is built from this checkout into /opt/<module>, runs as the systemd service
# <module>/deploy/<module>.service, keeps its data in /var/lib/<module>, and is served by Caddy
# through <module>/deploy/<module>.caddy.
set -euo pipefail

die() {
  echo "$*" >&2
  exit 1
}

SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR=/etc/axis-suite
CACHE_DIR=/var/cache/axis-suite
MODULE="${1:-}"
DOMAIN="${2:-}"

[[ $EUID -eq 0 ]] || die "Please run as root (sudo)."
[[ -n $MODULE ]] || die "Usage: sudo bash $0 <module> [domain]"
# On WSL, Windows' own node and pnpm are on the PATH; always use the Linux ones.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

MODULE_DIR="$SUITE_DIR/$MODULE"
APP_DIR="/opt/$MODULE"

# ---- The module and its ports ----------------------------------------------------------------

# deploy/modules.conf without comments and blank lines: module port local_port
registry() { sed -e 's/\r$//' -e 's/#.*//' "$SUITE_DIR/deploy/modules.conf" | awk 'NF'; }

dupes=$(registry | awk '{ print $2; print $3 }' | sort | uniq -d | xargs)
[[ -z $dupes ]] || die "deploy/modules.conf uses these ports twice: $dupes"
read -r PORT LOCAL_PORT < <(registry | awk -v m="$MODULE" '$1 == m { print $2, $3 }') || true
[[ -n ${PORT:-} ]] || die "Unknown module '$MODULE'. The modules are listed in deploy/modules.conf."
read -r HEIMDALL_PORT HEIMDALL_LOCAL_PORT < <(registry | awk '$1 == "heimdall" { print $2, $3 }') || true
for f in "$MODULE.service" "$MODULE.caddy"; do
  [[ -f $MODULE_DIR/deploy/$f ]] || die "Missing $MODULE/deploy/$f."
done
# The module's version, from its package.json (what CHANGELOG.md and the git tag call it).
VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$MODULE_DIR/package.json")

# ---- The suite's domain ----------------------------------------------------------------------

if [[ -z $DOMAIN && -f $CONF_DIR/suite.env ]]; then
  DOMAIN=$(sed -n 's/^AXIS_DOMAIN=//p' "$CONF_DIR/suite.env")
fi
[[ -n $DOMAIN ]] || die "First install on this server: also give the suite's domain, e.g. sudo bash $0 $MODULE example.com"
[[ $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "Not a domain, 'localhost' or an IPv4 address: $DOMAIN"
if [[ -f $CONF_DIR/suite.env ]] && ! grep -qx "AXIS_DOMAIN=$DOMAIN" "$CONF_DIR/suite.env"; then
  echo "Note: the suite's domain changes to $DOMAIN. Re-run this installer for every other module too."
fi

# On localhost or a bare IP, every module shares one host and has its own port.
LOCAL_MODE=""
IS_IP=""
[[ $DOMAIN =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && IS_IP=1
[[ $DOMAIN == localhost || -n $IS_IP ]] && LOCAL_MODE=1

# public_url <module> <local_port>
public_url() {
  if [[ -z $LOCAL_MODE ]]; then
    echo "https://$1.$DOMAIN"
  elif [[ $2 == 443 ]]; then
    echo "https://$DOMAIN"
  else
    echo "https://$DOMAIN:$2"
  fi
}

URL=$(public_url "$MODULE" "$LOCAL_PORT")
if [[ -n $LOCAL_MODE ]]; then
  SITE=$URL
  PUBLIC_PORT=$LOCAL_PORT
else
  SITE="$MODULE.$DOMAIN" # a bare host name also gets Caddy's HTTP-to-HTTPS redirect
  PUBLIC_PORT=443
fi

# ---- Packages and toolchain ------------------------------------------------------------------

echo "==> Packages (caddy, rsync, curl)"
apt-get update -q
apt-get install -y -q caddy rsync curl ca-certificates

# shellcheck source=node.sh
source "$SUITE_DIR/deploy/node.sh"
echo "==> Node.js $AXIS_NODE_MAJOR+ and pnpm (shared by the whole suite)"
ensure_node
ensure_pnpm "$SUITE_DIR/package.json"

# ---- Build -----------------------------------------------------------------------------------

echo "==> Building $MODULE"
# A clean copy of the suite every time, so nothing stale from an earlier build gets deployed.
# Files on /mnt/c look world-writable to Linux; --chmod gives the copy normal permissions.
BUILD_DIR="$CACHE_DIR/build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
rsync -a --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  --exclude node_modules/ --exclude dist/ --exclude '/*/data/' --exclude .git/ --exclude '*.db*' --exclude '*.tsbuildinfo' \
  "$SUITE_DIR/" "$BUILD_DIR/"
cd "$BUILD_DIR"
# Keep pnpm's package store next to the build, where every pnpm command below finds it.
printf '\nstoreDir: %s\n' "$CACHE_DIR/pnpm-store" >>pnpm-workspace.yaml
pnpm() { CI=true /usr/bin/pnpm "$@"; }
pnpm install --frozen-lockfile --filter "$MODULE..."
pnpm --filter "$MODULE..." run build
# Only the module's built files and its runtime dependencies (including workspace packages).
rm -rf "$APP_DIR.new"
pnpm --filter "$MODULE" deploy --prod "$APP_DIR.new" >/dev/null
chmod -R u=rwX,go=rX "$APP_DIR.new"
cd /
rm -rf "$BUILD_DIR"

# ---- Heimdall's users ------------------------------------------------------------------------

# When a module starts, it deletes the data of every owner who is not a Heimdall user (see
# knownUsers() in packages/heimdall-client), so a removed user leaves nothing behind. The list
# comes from the Heimdall that is running, or about to run when this installs Heimdall.
echo "==> Heimdall's users"
users_script=/opt/heimdall/dist/server/list-users.js
[[ $MODULE == heimdall ]] && users_script="$APP_DIR.new/dist/server/list-users.js"
users_line=""
if [[ -f $users_script ]]; then
  users=$(/usr/bin/node "$users_script") || die "Could not list Heimdall's users with $users_script."
  [[ -n $users ]] || die "Heimdall has no users. Refusing to hand the modules an empty list."
  while read -r name; do
    [[ $name =~ ^[A-Za-z0-9._-]+$ ]] || die "Not a username the installer accepts, in Heimdall's users.ts: '$name'"
  done <<<"$users"
  users_line="AXIS_USERS=$(paste -sd, - <<<"$users")"
  echo "    ${users_line#AXIS_USERS=}"
elif [[ $MODULE == heimdall ]]; then
  die "The build has no $users_script."
else
  echo "    Heimdall isn't installed (or is too old to list its users): modules keep every owner's data."
fi

# ---- Configuration ---------------------------------------------------------------------------

echo "==> Configuration in $CONF_DIR"
mkdir -p "$CONF_DIR"
cookie_domain=""
[[ -z $LOCAL_MODE ]] && cookie_domain=$DOMAIN
suite_env="# Written by axis-suite/deploy/install.sh from the domain it was given and Heimdall's users.
# Read by every module's service.
AXIS_DOMAIN=$DOMAIN
HEIMDALL_INTERNAL_URL=http://127.0.0.1:$HEIMDALL_PORT
HEIMDALL_PUBLIC_URL=$(public_url heimdall "$HEIMDALL_LOCAL_PORT")
# Heimdall shares its session cookie with every subdomain of this. Empty on localhost or an IP
# address, where all modules share one host and the cookie needs no domain.
COOKIE_DOMAIN=$cookie_domain"
if [[ -n $users_line ]]; then
  suite_env+="
# Every Heimdall username. When a module starts, it deletes the data of every owner not listed.
$users_line"
fi
suite_changed=""
if [[ ! -f $CONF_DIR/suite.env || $(<"$CONF_DIR/suite.env") != "$suite_env" ]]; then
  printf '%s\n' "$suite_env" >"$CONF_DIR/suite.env"
  suite_changed=1
fi
printf '%s\n' "# Written by axis-suite/deploy/install.sh from deploy/modules.conf." \
  "HOST=127.0.0.1" "PORT=$PORT" "PUBLIC_URL=$URL" >"$CONF_DIR/$MODULE.env"
chmod 644 "$CONF_DIR/suite.env" "$CONF_DIR/$MODULE.env"

# A module whose unit loads $CONF_DIR/<module>.key (LoadCredential=) gets that key on its first
# install: 32 random bytes, readable by root only; systemd hands it to the service. An existing
# key is never replaced, since what was encrypted with it can't be read with another one.
KEY_FILE="$CONF_DIR/$MODULE.key"
if grep -q "^LoadCredential=.*:$KEY_FILE$" "$MODULE_DIR/deploy/$MODULE.service" && [[ ! -e $KEY_FILE ]]; then
  echo "==> Making $MODULE's key: $KEY_FILE"
  echo "    Back it up now, somewhere safe and apart from the server: without it, $MODULE's data can't be read."
  (umask 077 && head -c 32 /dev/urandom | base64 >"$KEY_FILE.new")
  mv "$KEY_FILE.new" "$KEY_FILE"
fi

# ---- Service ---------------------------------------------------------------------------------

echo "==> Installing $MODULE ${VERSION:-(no version)} to $APP_DIR and (re)starting the $MODULE service"
install -m 644 "$MODULE_DIR/deploy/$MODULE.service" "/etc/systemd/system/$MODULE.service"
rm -rf "$APP_DIR.old"
if [[ -d $APP_DIR ]]; then mv "$APP_DIR" "$APP_DIR.old"; fi
mv "$APP_DIR.new" "$APP_DIR"
systemctl daemon-reload
systemctl enable "$MODULE" >/dev/null
systemctl restart "$MODULE"
rm -rf "$APP_DIR.old"

# Heimdall only sends users back to modules that registered here, one drop-in per module.
if [[ $MODULE != heimdall ]]; then
  dropin="/etc/systemd/system/heimdall.service.d/origin-$MODULE.conf"
  wanted="# Written by axis-suite/deploy/install.sh: $MODULE may receive users after sign-in.
[Service]
Environment=RETURN_ORIGIN_$(tr 'a-z-' 'A-Z_' <<<"$MODULE")=$URL"
  if [[ ! -f $dropin || $(<"$dropin") != "$wanted" ]]; then
    echo "==> Letting Heimdall send users back to $URL"
    mkdir -p "${dropin%/*}"
    printf '%s\n' "$wanted" >"$dropin"
    systemctl daemon-reload
    systemctl try-restart heimdall
  fi
fi

# Every running module reads suite.env, so a change there restarts them all. A change in
# AXIS_USERS thereby makes each module delete the data of users removed from Heimdall.
if [[ -n $suite_changed ]]; then
  # shellcheck disable=SC2046
  systemctl try-restart $(registry | awk -v m="$MODULE" '$1 != m { print $1 }')
fi

# ---- Caddy -----------------------------------------------------------------------------------

echo "==> Caddy site $URL"
CADDYFILE=/etc/caddy/Caddyfile
if [[ -f $CADDYFILE ]] && ! grep -q "Managed by axis-suite/deploy/install.sh" "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"
  echo "    The existing Caddyfile is backed up next to it."
fi
tls="# automatic HTTPS"
[[ -n $IS_IP ]] && tls="tls internal"
sed "s|@TLS@|$tls|" "$SUITE_DIR/deploy/Caddyfile" >"$CADDYFILE"
mkdir -p /etc/caddy/sites.d
sed -e "s|@SITE@|$SITE|" -e "s|@PORT@|$PORT|" -e "s|@APP_DIR@|$APP_DIR|" \
  "$MODULE_DIR/deploy/$MODULE.caddy" >"/etc/caddy/sites.d/$MODULE.caddy"
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---- Health check ----------------------------------------------------------------------------

echo "==> Health check"
for _ in $(seq 10); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then
    host=${URL#https://}
    host=${host%%:*}
    code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$host:$PUBLIC_PORT:127.0.0.1" "$URL/" || true)
    if [[ $code =~ ^[23] ]]; then
      echo "$MODULE ${VERSION:-} is running. Open: $URL"
    else
      # With a real domain, the certificate may still be on its way (or DNS not set up yet).
      echo "$MODULE is running on port $PORT, but $URL answered '$code' through Caddy. Check: journalctl -u caddy -n 50" >&2
    fi
    exit 0
  fi
  sleep 1
done
die "$MODULE did not answer on port $PORT. Check: journalctl -u $MODULE -n 50"
