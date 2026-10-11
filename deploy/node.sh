# Node.js for the whole Axis Suite. Sourced by every app's installer, so all
# apps on a server share one /usr/bin/node. To move the suite to a newer Node,
# change AXIS_NODE_MAJOR here (and .node-version / the "engines" fields).

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
