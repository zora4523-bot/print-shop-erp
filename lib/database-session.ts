import type { PoolConfig } from 'pg';

export const DATABASE_SESSION_TIME_ZONE = 'UTC';

/**
 * Prisma maps PostgreSQL `timestamp without time zone` values to UTC instants.
 * Force every application connection to write the same UTC wall clock even
 * when PostgreSQL itself is configured for Asia/Shanghai. Existing startup
 * options are preserved and UTC is applied last so it remains authoritative.
 */
export function databasePoolConfig(connectionString: string): PoolConfig {
  const parsedConnectionString = new URL(connectionString);
  const configuredOptions = parsedConnectionString.searchParams
    .get('options')
    ?.trim();

  // node-postgres gives an `options` value embedded in connectionString
  // precedence over PoolConfig.options. Remove it from the URL before passing
  // the merged value below, otherwise production URLs with startup options can
  // silently override the required UTC session setting.
  parsedConnectionString.searchParams.delete('options');
  const options = [
    configuredOptions,
    `-c timezone=${DATABASE_SESSION_TIME_ZONE}`,
  ]
    .filter(Boolean)
    .join(' ');

  return { connectionString: parsedConnectionString.toString(), options };
}
