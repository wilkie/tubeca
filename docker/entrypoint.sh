#!/bin/sh
# Apply pending migrations, then run the backend in whatever role was requested.
# JWT_SECRET must be provided by the environment; the backend refuses to start
# in production without it.
set -e
mkdir -p /data
cd /app/backend
if [ "${TUBECA_ROLE:-all}" != "worker" ] || [ "${TUBECA_MIGRATE:-1}" = "1" ]; then
  # A migration is the one step that can leave a library unusable, so keep a
  # copy of the database first. TUBECA_DB_FILE overrides where it looks.
  DB_FILE="${TUBECA_DB_FILE:-/data/tubeca.db}"
  if [ -f "$DB_FILE" ]; then
    /app/backend/backup-database.sh "$DB_FILE" "${TUBECA_BACKUP_DIR:-/data/backups}"
  fi
  npx prisma migrate deploy
fi
exec node --enable-source-maps dist/index.js
