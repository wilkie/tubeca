#!/bin/sh
# Copy the SQLite database before anything migrates it.
#
# A migration is the one upgrade step that can leave a library unusable, and
# SQLite has no undo. This makes a timestamped copy first, so a failed upgrade
# is recovered by stopping the services and copying the file back.
#
# Usage: backup-database.sh <database file> [backup directory] [keep count]
# Exits non-zero if the copy fails, so a caller can refuse to migrate.
set -eu

DB_FILE="${1:?usage: backup-database.sh <database file> [backup dir] [keep]}"
BACKUP_DIR="${2:-$(dirname "$DB_FILE")/backups}"
KEEP="${3:-5}"

if [ ! -f "$DB_FILE" ]; then
  echo ":: No database at $DB_FILE yet; nothing to back up."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%d-%H%M%S)
TARGET="$BACKUP_DIR/$(basename "$DB_FILE").$STAMP"

# `.backup` is safe against a running writer; a plain copy is not, so it is
# only the fallback for a machine without the sqlite3 CLI.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$TARGET'"
else
  cp "$DB_FILE" "$TARGET"
fi

echo ":: Database backed up to $TARGET"

# Keep the most recent few; older ones are of little use and a library
# database is not small.
ls -1t "$BACKUP_DIR"/"$(basename "$DB_FILE")".* 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
  echo ":: Removed old backup $old"
done
