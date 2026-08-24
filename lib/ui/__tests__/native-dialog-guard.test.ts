import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['app', 'components/business', 'components/ui-business'];
const NATIVE_DIALOG_CALL = /\b(?:window\s*\.\s*)?(?:alert|confirm)\s*\(/;

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionSources(path);
    }
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) return [];
    return [path];
  });
}

describe('UI native dialog guard', () => {
  it('keeps the ESLint production-code guard enabled', () => {
    const config = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');

    expect(config).toContain("CallExpression[callee.name='alert']");
    expect(config).toContain("CallExpression[callee.name='confirm']");
    expect(config).toContain("[callee.object.name='window']");
  });

  it('does not use blocking browser dialogs in production UI code', () => {
    const violations = SOURCE_ROOTS.flatMap((relativeRoot) =>
      productionSources(join(ROOT, relativeRoot))
        .filter((path) => NATIVE_DIALOG_CALL.test(readFileSync(path, 'utf8')))
        .map((path) => path.slice(ROOT.length + 1)),
    );

    expect(violations).toEqual([]);
  });
});
