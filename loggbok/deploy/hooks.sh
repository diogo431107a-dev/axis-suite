# Loggbok's own install steps. Sourced by axis-suite/deploy/install.sh.

# Runs after the build, before the new version replaces the old one. It moves installs from
# before Loggbok ran from /opt/loggbok as its own service user. Those ran from a checkout
# (WorkingDirectory=) as a login user, configured Heimdall through a drop-in of their own, and,
# before StateDirectory, kept the notes in <checkout>/server/notes.db.
before_install() {
  rm -f /etc/systemd/system/heimdall.service.d/loggbok-wsl.conf

  local old_dir
  old_dir=$(sed -n 's/^WorkingDirectory=//p' /etc/systemd/system/loggbok.service 2>/dev/null || true)
  [[ -n $old_dir && $old_dir != /opt/loggbok ]] || return 0

  if [[ -f $old_dir/server/notes.db && ! -e /var/lib/loggbok/notes.db ]]; then
    echo "    Moving the notes from $old_dir/server/ to /var/lib/loggbok/"
    systemctl stop loggbok 2>/dev/null || true
    install -d -m 700 /var/lib/loggbok
    mv "$old_dir"/server/notes.db* /var/lib/loggbok/
  fi
  # systemd hands /var/lib/loggbok over to the new service user when the service starts.
  echo "    Loggbok used to run from $old_dir and now runs from /opt/loggbok."
  echo "    Delete the old copy once you no longer need it."
}
