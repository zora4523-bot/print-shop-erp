import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('worker salary dispute entry', () => {
  it('links every piecework ledger row back to its production task dispute surface', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'app', '(worker)', 'worker', 'salary', '[id]', 'page.tsx'),
      'utf8',
    );
    expect(source).toContain('/worker/tasks/${item.productionTaskId}');
    expect(source).toContain('查看任务 / 提出计件异议');
  });
});
