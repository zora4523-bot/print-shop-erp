// Builds the release E2E bundle (`.next-release`) once, with exactly the
// environment the Playwright release web server uses, so CI shards can share it.
import { spawnSync } from 'node:child_process';
import { createE2eConfig } from './lib/playwright-config';

const config = createE2eConfig('release');
const webServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
if (!webServer?.env) throw new Error('release Playwright config has no web server environment');

const result = spawnSync('pnpm', ['exec', 'next', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, ...webServer.env },
});
process.exit(result.status ?? 1);
