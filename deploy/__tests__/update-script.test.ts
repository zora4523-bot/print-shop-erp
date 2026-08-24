import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('production deploy acceptance', () => {
  it('fails before releasing quiesce protection unless :3000 is loopback-only', async () => {
    const script = await readFile(resolve('deploy/update.sh'), 'utf8');

    expect(script).toContain("ss -H -ltn 'sport = :3000'");
    expect(script).toContain('listeners" != "127.0.0.1:3000"');
    expect(script).toMatch(
      /if \[ "\$ok" = "1" \]; then\s+assert_web_loopback_binding\s+DEPLOYMENT_QUIESCED=0/,
    );
  });
});
