import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production deploy acceptance', () => {
  it('fails before releasing quiesce protection unless every release gate passes', async () => {
    const script = await readFile(resolve('deploy/update.sh'), 'utf8');

    expect(script).toContain("ss -H -ltn 'sport = :3000'");
    expect(script).toContain('listeners" != "127.0.0.1:3000"');
    expect(script).toContain('node scripts/deploy-jobs-gate.mjs');
    expect(script).toContain('JOBS_HEALTH_URL');
    expect(script).toContain('DEPLOY_JOBS_GATE_MAX_SECONDS:-120');
    expect(script).toContain('curl --connect-timeout 2 --max-time 5');
    expect(script).toContain('DEPLOY_JOBS_GATE_CONNECTED_SETTLE_SECONDS:-6');
    expect(script).toContain('NOT_REQUIRED)');
    expect(script).toContain('WAITING_*)');
    expect(script).toContain('观察期结束时仍为');
    expect(script).not.toContain('该状态会自动重连，发布继续');
    expect(script).toMatch(
      /if \[ "\$ok" = "1" \]; then\s+assert_web_loopback_binding\s+assert_deploy_jobs_gate\s+DEPLOYMENT_QUIESCED=0/,
    );
  });
});
