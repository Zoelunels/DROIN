#!/usr/bin/env bash
# Nightly backup of DROIN (cron, set up by deploy/install.sh): the database and the receipt photos,
# into /var/backups/droin, keeping the last 14 days. Run by hand any time: droin-backup
#
# These copies are on the same server. Download one now and then, so a dead server doesn't take
# your only copy with it (see deploy/DEPLOY.md).
set -euo pipefail

DIR=/var/backups/droin
STAMP=$(date +%F)
mkdir -p "$DIR"
chmod 700 "$DIR"

runuser -u postgres -- pg_dump --format=custom droin > "$DIR/db-$STAMP.dump"
tar -C /home/droin/droin/backend -czf "$DIR/uploads-$STAMP.tgz" uploads 2>/dev/null || true

find "$DIR" -type f -mtime +14 -delete
echo "Backed up to $DIR ($(du -sh "$DIR" | cut -f1) in total)"
