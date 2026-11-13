#!/usr/bin/env bash
# DROIN backend on a Debian 12/13 server: first install, and every update after it.
#
#   1. On your computer (E:\Learning\buku-kas):  pack and upload, see deploy/DEPLOY.md
#   2. On the server, as root:
#        rm -rf /root/droin-upload && mkdir -p /root/droin-upload
#        tar -xzf /root/droin.tgz -C /root/droin-upload
#        bash /root/droin-upload/deploy/install.sh
#
# Safe to run again: steps that are already done are skipped, and the database, its password,
# .env, uploaded receipts and the OCR install are kept. What it sets up:
#   - 2 GB swap (the server has 2 GB RAM; reading a receipt needs headroom)
#   - PostgreSQL, listening on this server only, with its own user and a random password
#   - Bun and the backend under a separate "droin" user, run by systemd (starts on boot,
#     restarts if it crashes), PaddleOCR for receipt scanning
#   - a firewall that only lets in SSH, HTTP/HTTPS and (until HTTPS is set up) port 3000
#   - a nightly backup of the database and receipts
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"   # the unpacked upload (has backend/ and deploy/)
APP_USER=droin
APP_HOME=/home/$APP_USER
APP_DIR=$APP_HOME/droin
BACKEND=$APP_DIR/backend
ENV_FILE=$BACKEND/.env
BUN=$APP_HOME/.bun/bin/bun
as_app() { runuser -u "$APP_USER" -- bash -c "export PATH=$APP_HOME/.bun/bin:\$PATH; cd '$BACKEND'; $1"; }

[ -d "$SRC/backend/src" ] || { echo "Can't find backend/ next to deploy/ in $SRC. Unpack droin.tgz first."; exit 1; }

echo "==> Swap"
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Use swap only when memory is really short; keep the app itself in RAM.
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-droin-swap.conf
  sysctl -q -p /etc/sysctl.d/90-droin-swap.conf
fi

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql python3 python3-venv curl unzip openssl ufw cron libgl1 >/dev/null
# OpenCV (used by PaddleOCR) needs GLib; Debian 13 renamed the package to libglib2.0-0t64.
apt-get install -y -qq libglib2.0-0t64 >/dev/null 2>&1 || apt-get install -y -qq libglib2.0-0 >/dev/null

echo "==> App user and Bun"
id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
[ -x "$BUN" ] || runuser -u "$APP_USER" -- bash -c 'curl -fsSL https://bun.sh/install | bash' >/dev/null

echo "==> Code"
mkdir -p "$APP_DIR"
# Copy over the uploaded code. .env, uploads/ and the OCR install are not in the upload, so they stay.
tar -C "$SRC" -cf - backend deploy | tar -C "$APP_DIR" -xf -
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Database"
systemctl enable --now postgresql >/dev/null
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  if runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'droin'" | grep -q 1; then
    runuser -u postgres -- psql -q -c "ALTER USER droin WITH PASSWORD '$DB_PASSWORD'"
  else
    runuser -u postgres -- psql -q -c "CREATE USER droin WITH PASSWORD '$DB_PASSWORD'"
  fi
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'droin'" | grep -q 1 \
    || runuser -u postgres -- psql -q -c "CREATE DATABASE droin OWNER droin"
  sed "s|__DB_PASSWORD__|$DB_PASSWORD|" "$APP_DIR/deploy/env.production.example" > "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "    created $ENV_FILE (the database password is in it)"
fi

echo "==> Dependencies and migrations"
as_app "bun install --production >/dev/null"
as_app "bun run migrate"

echo "==> Receipt OCR (PaddleOCR; first time downloads ~300 MB)"
[ -x "$BACKEND/ocr-service/.venv/bin/python" ] || as_app "bun run ocr setup"

echo "==> Service"
install -m 644 "$APP_DIR/deploy/droin.service" /etc/systemd/system/droin.service
systemctl daemon-reload
systemctl enable droin >/dev/null
systemctl restart droin

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
# Port 3000 is only for testing by IP: open until Caddy serves the API over HTTPS, closed after.
if grep -qs "reverse_proxy 127.0.0.1:3000" /etc/caddy/Caddyfile; then
  ufw delete allow 3000/tcp >/dev/null 2>&1 || true
else
  ufw allow 3000/tcp >/dev/null
fi
ufw --force enable >/dev/null

echo "==> Nightly backup"
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/droin-backup
echo "30 2 * * * root /usr/local/bin/droin-backup" > /etc/cron.d/droin-backup

echo "==> Checking it's up"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo
    echo "DROIN is running."
    echo "  Test from your browser:  http://YOUR-SERVER-IP:3000/health"
    echo "  Logs:                    journalctl -u droin -f"
    exit 0
  fi
  sleep 2
done
echo "The backend didn't answer on port 3000. See what went wrong with: journalctl -u droin -n 50"
exit 1
