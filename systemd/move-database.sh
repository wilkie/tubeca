#!/bin/sh
# Move a SQLite database to a new location, sidecars and all.
#
# The database used to live under the install tree (program files); it belongs
# in /var/lib. Both install paths call this, and both may be re-run, so it is a
# no-op when there is nothing to move or the destination already exists.
#
# Usage: move-database.sh <old database> <new database>
set -eu

OLD="${1:?usage: move-database.sh <old database> <new database>}"
NEW="${2:?usage: move-database.sh <old database> <new database>}"

if [ ! -f "$OLD" ]; then
  exit 0
fi

if [ -f "$NEW" ]; then
  echo ":: $NEW already exists; leaving $OLD where it is."
  exit 0
fi

mkdir -p "$(dirname "$NEW")"
mv "$OLD" "$NEW"

# A database that was not closed cleanly keeps its most recent writes in the
# write-ahead log, so the sidecars have to travel with it.
for suffix in -wal -shm; do
  if [ -f "$OLD$suffix" ]; then
    mv "$OLD$suffix" "$NEW$suffix"
  fi
done

echo ":: Moved the database to $NEW"
