import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('BeginTaskButton pending and touch contract', () => {
  it('announces pending state and keeps the primary action full-width at 52px', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'BeginTaskButton.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<form action={formAction} aria-busy={pending}>');
    expect(source).toContain('className="min-h-[52px] w-full');
    expect(source).toContain('disabled={pending}');
  });
});
