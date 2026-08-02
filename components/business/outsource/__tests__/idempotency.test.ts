import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nextOutsourceIdempotencyKey } from '../idempotency';

describe('outsource form idempotency keys', () => {
  it('rotates only after success and preserves the key after failures', () => {
    const createKey = vi.fn(() => 'next-key');
    expect(
      nextOutsourceIdempotencyKey(
        'current-key',
        { status: 'success' },
        createKey,
      ),
    ).toBe('next-key');
    expect(createKey).toHaveBeenCalledTimes(1);

    for (const status of ['invalid', 'error'] as const) {
      expect(
        nextOutsourceIdempotencyKey(
          'current-key',
          { status },
          createKey,
        ),
      ).toBe('current-key');
    }
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it('wires the stable key into both hidden form fields', () => {
    for (const file of ['CreateOutsourceForm.tsx', 'OutsourceAmountForm.tsx']) {
      const source = readFileSync(
        path.join(process.cwd(), 'components', 'business', 'outsource', file),
        'utf8',
      );
      expect(source).toContain(
        '<input type="hidden" name="idempotencyKey" value={idempotencyKey} />',
      );
      expect(source).toContain('nextOutsourceIdempotencyKey(');
    }
  });
});
