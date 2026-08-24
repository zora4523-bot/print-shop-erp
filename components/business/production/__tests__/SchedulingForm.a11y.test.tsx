import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SchedulingForm status announcements', () => {
  it('keeps an initial missing-worker prerequisite neutral without muting dynamic feedback', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'SchedulingForm.tsx',
      ),
      'utf8',
    );
    const missingWorkerStart = source.indexOf('{missingWorkers ? (');
    const dynamicOverrideStart = source.indexOf(
      '{overrideRows.length > 0 && !allOverridesExplained ? (',
      missingWorkerStart,
    );
    const missingWorkerBlock = source.slice(
      missingWorkerStart,
      dynamicOverrideStart,
    );

    expect(missingWorkerStart).toBeGreaterThan(-1);
    expect(dynamicOverrideStart).toBeGreaterThan(missingWorkerStart);
    expect(missingWorkerBlock).toContain('<DisabledReason');
    expect(missingWorkerBlock).toContain('cause="prerequisite"');
    expect(missingWorkerBlock).not.toContain('role="alert"');
    expect(source.slice(dynamicOverrideStart)).toMatch(
      /overrideRows\.length[\s\S]{0,180}?role="alert"/,
    );
  });
});
