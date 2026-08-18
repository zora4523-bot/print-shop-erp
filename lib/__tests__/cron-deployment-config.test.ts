import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXPECTED_ENDPOINTS = [
  'cs-period-ending',
  'cs-settle',
  'daily-salary',
  'generate-bills',
  'hourly-payroll',
  'order-export-cleanup',
  'order-overdue',
  'outsource-overdue',
] as const;

describe('cron deployment configuration', () => {
  it('allowlists and schedules every protected cron endpoint', async () => {
    const [runner, crontab] = await Promise.all([
      readFile(resolve('deploy/run-cron.sh'), 'utf8'),
      readFile(resolve('deploy/crontab.example'), 'utf8'),
    ]);

    const allowlist = runner.match(
      /daily-salary\|[^)]+generate-bills/,
    )?.[0];
    expect(allowlist?.split('|').sort()).toEqual([...EXPECTED_ENDPOINTS].sort());

    const scheduled = Array.from(
      crontab.matchAll(/print-shop-erp-cron ([a-z-]+)$/gm),
      (match) => match[1],
    );
    expect(scheduled.sort()).toEqual([...EXPECTED_ENDPOINTS].sort());
  });
});
