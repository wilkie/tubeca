#!/bin/sh
# Apply pending migrations, then run the backend in whatever role was requested.
# JWT_SECRET must be provided by the environment; the backend refuses to start
# in production without it.
set -e
mkdir -p /data
cd /app/backend
if [ "${TUBECA_ROLE:-all}" != "worker" ] || [ "${TUBECA_MIGRATE:-1}" = "1" ]; then
  npx prisma migrate deploy
fi
exec node dist/index.js
