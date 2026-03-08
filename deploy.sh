#!/bin/bash
set -e

REMOTE="kevincoyle@framedesk.local"
REMOTE_DIR="dev/dashboard"
DASHBOARD_DIR="$(dirname "$0")/dashboard"

echo "=== Deploying firmware ==="
pio run --target upload

echo ""
echo "=== Deploying dashboard ==="
scp "$DASHBOARD_DIR"/{server.js,package.json,package-lock.json,Dockerfile,docker-compose.yml,.env.example} "$REMOTE:$REMOTE_DIR/"
scp -r "$DASHBOARD_DIR"/{scripts,migrations,routes} "$REMOTE:$REMOTE_DIR/"
ssh "$REMOTE" "cd ~/$REMOTE_DIR && docker compose up -d --build"

echo ""
echo "=== Done ==="
echo "Firmware: uploaded to /dev/ttyACM2"
echo "Dashboard: http://framedesk.local:3000"
echo ""
echo "NOTE: Make sure .env exists on server with LibreView credentials"
