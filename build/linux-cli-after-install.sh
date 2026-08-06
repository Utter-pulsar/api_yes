#!/bin/sh
set -e

cat > /usr/bin/apiyes <<'EOF'
#!/bin/sh
export APIYES_ENV=prod
export ELECTRON_RUN_AS_NODE=1
exec /opt/API-YES/api-yes /opt/API-YES/resources/app.asar/out/main/cli.js --env prod "$@"
EOF
chmod 755 /usr/bin/apiyes
