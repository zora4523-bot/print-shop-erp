-- Read-only; run as postgres on the primary. No forced WAL switch or credential output.
-- Alert on pending_age_seconds >= 300, any recent un-recovered archive failure,
-- low space on PGDATA/repo1/spool, or either systemd backup service failing.
SELECT pg_is_in_recovery() AS is_standby,
       archived_count, failed_count,
       last_archived_time, last_failed_time,
       (last_failed_time IS NOT NULL AND
        (last_archived_time IS NULL OR last_failed_time > last_archived_time)) AS archive_failure_pending
FROM pg_stat_archiver;
SELECT count(*) AS pending_segments,
       coalesce(extract(epoch FROM clock_timestamp() - min(stat.modification)), 0)::bigint AS pending_age_seconds
FROM pg_ls_dir('pg_wal/archive_status') AS entry(name)
CROSS JOIN LATERAL pg_stat_file('pg_wal/archive_status/' || entry.name, true) AS stat
WHERE entry.name ~ '^[0-9A-F]{24}\.ready$';
-- This is cluster-level telemetry. Validate repo2 independently with pgBackRest check
-- and a restore; pg_stat_archiver alone does not prove the OSS repository is healthy.
