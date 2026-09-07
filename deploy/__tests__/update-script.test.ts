import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production deploy acceptance', () => {
  it('fails before releasing quiesce protection unless every release gate passes', async () => {
    const script = await readFile(resolve('deploy/update.sh'), 'utf8');

    expect(script).toContain("ss -H -ltn 'sport = :3000'");
    expect(script).toContain('listeners" != "127.0.0.1:3000"');
    expect(script).toContain('node scripts/deploy-jobs-gate.mjs --wait "$JOBS_HEALTH_URL"');
    expect(script).toContain('JOBS_HEALTH_URL');
    const preflight = script.indexOf('node scripts/deploy-jobs-gate.mjs --check-config "$JOBS_HEALTH_URL"');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(script.indexOf('\nDEPLOYMENT_QUIESCED=1'));
    expect(script).toContain('pm2 stop "$WEB_APP_NAME"');
    expect(script).toContain('pm2 stop "$LIGHT_WORKER_NAME"');
    expect(script).toContain('pm2 stop "$HEAVY_WORKER_NAME"');
    expect(script).not.toContain('该状态会自动重连，发布继续');
    expect(script).toMatch(
      /if \[ "\$ok" = "1" \]; then\s+assert_web_loopback_binding\s+assert_deploy_jobs_gate\s+DEPLOYMENT_QUIESCED=0/,
    );
  });
});
