import type { PoolConfig } from 'pg';

export const DATABASE_SESSION_TIME_ZONE = 'UTC';

/**
 * Prisma maps PostgreSQL `timestamp without time zone` values to UTC instants.
 * Force every application connection to write the same UTC wall clock even
 * when PostgreSQL itself is configured for Asia/Shanghai. Existing startup
 * options are preserved and UTC is applied last so it remains authoritative.
 */
export const DATABASE_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 20_000 };

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function assertWorkerPoolCapacity(max: number, concurrency: number): void {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || max < concurrency * 2) {
    throw new Error('Worker database pool must have at least twice the lane concurrency for independent lease heartbeats');
  }
}

export function databasePoolConfig(connectionString: string, config: {
  role?: 'web' | 'worker'; max?: number; connectionTimeoutMillis?: number;
} = {}): PoolConfig {
  const parsedConnectionString = new URL(connectionString);
  const role = config.role ?? process.env.DATABASE_PROCESS_ROLE ?? 'web';
  if (role !== 'web' && role !== 'worker') throw new Error('Invalid DATABASE_PROCESS_ROLE');
  const max = positiveInteger(config.max ?? process.env.DATABASE_POOL_MAX ?? parsedConnectionString.searchParams.get('max') ?? (role === 'worker' ? 5 : 25), 'DATABASE_POOL_MAX');
  const connectionTimeoutMillis = positiveInteger(config.connectionTimeoutMillis ?? process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? parsedConnectionString.searchParams.get('connectionTimeoutMillis') ?? 10_000, 'DATABASE_POOL_CONNECTION_TIMEOUT_MS');
  // Resolve URL overrides explicitly, then give pg one authoritative budget.
  parsedConnectionString.searchParams.delete('max');
  parsedConnectionString.searchParams.delete('connectionTimeoutMillis');
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

  return { connectionString: parsedConnectionString.toString(), options, max, connectionTimeoutMillis };
}
