type Environment = Record<string, string | undefined>;

export type E2eDatabase = { url: string; databaseName: string; target: string };

export function postgresDatabaseIdentity(value: string): Omit<E2eDatabase, 'url'> | null {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) return null;
    // pg query parameters can override the URL authority/database.
    if (['host', 'hostaddr', 'port', 'database', 'dbname', 'service'].some((key) => url.searchParams.has(key))) return null;
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (!databaseName || databaseName.includes('/') || databaseName.includes('\0')) return null;
    // Match pg's decoding before comparing targets; encoded hostnames must not
    // disguise the ordinary database as a separate test server.
    const decodedHost = decodeURIComponent(url.hostname).toLowerCase().replace(/\.$/, '');
    if (!decodedHost || /[\0\s/\\]/.test(decodedHost)) return null;
    const hostname = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(decodedHost)
      ? 'localhost' : decodedHost;
    return { databaseName, target: `${hostname}:${url.port || '5432'}/${databaseName}` };
  } catch {
    return null;
  }
}

export function isDisposableE2eDatabaseName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name) &&
    /(?:^|_)(?:e2e|test|ci)(?:_|$)/.test(name) &&
    !/(?:^|_)(?:prod|production|live)(?:_|$)/.test(name);
}

function hasActivatedDatabase(env: Environment): boolean {
  return env.E2E_APPEND_ONLY_DATABASE_ISOLATED === '1' &&
    !!env.E2E_DATABASE_URL?.trim() && env.DATABASE_URL?.trim() === env.E2E_DATABASE_URL.trim();
}

export function preserveOriginalDatabaseTarget(env: Environment): void {
  // Only an already activated Playwright child process may reuse this marker.
  // A stale marker in a shell must not replace the current ordinary URL.
  if (!hasActivatedDatabase(env)) {
    env.E2E_ORIGINAL_DATABASE_TARGET = env.DATABASE_URL
      ? postgresDatabaseIdentity(env.DATABASE_URL)?.target ?? 'INVALID'
      : '';
  }
}

export function assertE2eDatabaseEnvironment(env: Environment = process.env): E2eDatabase {
  const url = env.E2E_DATABASE_URL?.trim();
  if (!url) throw new Error('E2E_DATABASE_URL is required; ordinary DATABASE_URL is never an E2E fallback.');
  const identity = postgresDatabaseIdentity(url);
  if (!identity) throw new Error('E2E_DATABASE_URL must identify one PostgreSQL database without target overrides.');
  if (!isDisposableE2eDatabaseName(identity.databaseName)) {
    throw new Error('E2E database name must contain an e2e/test/ci segment and must not name a production database.');
  }
  if (env.E2E_DATABASE_CONFIRM_DATABASE !== identity.databaseName) {
    throw new Error('E2E_DATABASE_CONFIRM_DATABASE must exactly match the disposable E2E database name.');
  }
  const original = hasActivatedDatabase(env) ? env.E2E_ORIGINAL_DATABASE_TARGET :
    (env.DATABASE_URL ? postgresDatabaseIdentity(env.DATABASE_URL)?.target : null);
  if (!original || original === 'INVALID') {
    throw new Error('A valid original DATABASE_URL is required to verify E2E isolation.');
  }
  // Host aliases cannot be reliably resolved offline. Require a distinct name
  // as well, even across different hosts, before allowing destructive fixtures.
  if (original === identity.target || original.slice(original.lastIndexOf('/') + 1) === identity.databaseName) {
    throw new Error('E2E_DATABASE_URL points to the ordinary database; use a separate disposable database.');
  }
  return { url, ...identity };
}

export function activateE2eDatabase(env: Environment = process.env): E2eDatabase {
  preserveOriginalDatabaseTarget(env);
  const database = assertE2eDatabaseEnvironment(env);
  env.DATABASE_URL = database.url;
  env.E2E_APPEND_ONLY_DATABASE_ISOLATED = '1';
  env.E2E_APPEND_ONLY_DATABASE_REASON = 'ISOLATED';
  return database;
}

export function assertActivatedE2eDatabase(env: Environment = process.env): E2eDatabase {
  const database = assertE2eDatabaseEnvironment(env);
  if (env.DATABASE_URL?.trim() !== database.url || env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('The validated isolated E2E database was not activated by Playwright configuration.');
  }
  return database;
}

export function controlledE2eBaseUrl(value: string | undefined, mode: 'development' | 'release'): string {
  const defaultPort = mode === 'release' ? 3200 : 3100;
  if (!value?.trim()) return `http://127.0.0.1:${defaultPort}`;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('E2E_BASE_URL must be a loopback HTTP origin with a dedicated port.'); }
  const port = Number(url.port);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000) {
    throw new Error('E2E_BASE_URL must be a loopback HTTP origin with a dedicated non-3000 port.');
  }
  return `http://127.0.0.1:${port}`;
}
