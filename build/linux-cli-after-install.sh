#!/bin/sh
set -e

cat > /usr/bin/apiyes <<'EOF'
#!/bin/sh
export APIYES_ENV=prod
export ELECTRON_RUN_AS_NODE=1
exec /opt/API-YES/api-yes /opt/API-YES/resources/app.asar/out/main/cli.js --env prod "$@"
EOF
chmod 755 /usr/bin/apiyes

# Some desktop environments cache .desktop metadata aggressively during package
# installation. Refresh the common caches so the launcher sees the installed icon.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
