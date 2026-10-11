# Node.js and pnpm for the whole Axis Suite, sourced by deploy/install.sh. Every module on a
# server runs on the one /usr/bin/node. To move the suite to a newer Node, change
# AXIS_NODE_MAJOR here, in .node-version, and the "engines" fields; then re-run the installer
# for every module.

AXIS_NODE_MAJOR=22

# Installs Node.js $AXIS_NODE_MAJOR from NodeSource unless /usr/bin/node is already
# that version or newer. NodeSource's nodejs includes npm; on a server that has
# Debian's nodejs/npm, apt replaces them, which is expected.
ensure_node() {
  if ! /usr/bin/node -e "process.exit(+process.versions.node.split('.')[0] >= $AXIS_NODE_MAJOR ? 0 : 1)" 2>/dev/null; then
    curl -fsSL "https://deb.nodesource.com/setup_${AXIS_NODE_MAJOR}.x" | bash -
    apt-get install -y -q nodejs
  fi
  echo "    node $(/usr/bin/node --version), npm $(/usr/bin/npm --version)"
}

# Installs the pnpm version named by "packageManager" in the suite's package.json ($1).
ensure_pnpm() {
  local want
  want=$(/usr/bin/node -p "require(process.argv[1]).packageManager.split('@')[1]" "$1")
  if [[ $(/usr/bin/pnpm --version 2>/dev/null) != "$want" ]]; then
    /usr/bin/npm install -g --no-audit --no-fund "pnpm@$want" >/dev/null
  fi
  echo "    pnpm $(/usr/bin/pnpm --version)"
}
