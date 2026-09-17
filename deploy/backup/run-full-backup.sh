#!/usr/bin/env bash
# Installed on the Pigsty database host; executes pgBackRest, not custom backup formats.
set -euo pipefail
repo="${1:-}"
if [[ "$repo" != 1 && "$repo" != 2 ]]; then
  echo 'usage: run-full-backup.sh <1|2>' >&2
  exit 64
fi
: "${PGBACKREST_STANZA:?Set the approved production stanza}"
if [[ ! "$PGBACKREST_STANZA" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo 'Invalid stanza name' >&2
  exit 64
fi
if [[ "$(id -un)" != postgres ]]; then
  echo 'Run as postgres' >&2
  exit 77
fi
# Fail on a standby rather than reporting a backup that was never created.
recovery="$(psql -X -A -t -v ON_ERROR_STOP=1 -d postgres -c 'SELECT pg_is_in_recovery()')"
if [[ "$recovery" != f ]]; then
  echo 'Backup must run on the primary' >&2
  exit 1
fi
exec pgbackrest --stanza="$PGBACKREST_STANZA" --repo="$repo" --type=full backup
