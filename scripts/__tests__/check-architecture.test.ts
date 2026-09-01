import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeArchitecture,
  checkArchitecture,
  createArchitectureDebt,
  findArchitectureViolations,
  runArchitectureCli,
  type ArchitectureDebt,
} from '../check-architecture';

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('architecture dependency gate', () => {
  it('detects a cycle between production modules', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
    });

    const violations = findArchitectureViolations(
      analyzeArchitecture({ rootDir: root }),
      emptyDebt(),
    );

    expect(violations).toEqual([
      expect.objectContaining({
        kind: 'cycle',
        message: expect.stringContaining('lib/a.ts'),
      }),
    ]);
  });

  it.each([
    [
      'lib-to-components',
      'lib/use-view.ts',
      "import { view } from '../components/view';\nexport const value = view;\n",
      'components/view.ts',
    ],
    [
      'lib-to-app',
      'lib/use-page.ts',
      "import { page } from '../app/page';\nexport const value = page;\n",
      'app/page.ts',
    ],
    [
      'actions-to-app',
      'actions/use-page.ts',
      "import { page } from '../app/page';\nexport const value = page;\n",
      'app/page.ts',
    ],
  ] as const)(
    'detects a new %s reverse edge',
    (rule, sourcePath, source, targetPath) => {
      const root = fixture({
        [sourcePath]: source,
        [targetPath]: 'export const page = 1;\nexport const view = 1;\n',
      });

      const violations = findArchitectureViolations(
        analyzeArchitecture({ rootDir: root }),
        emptyDebt(),
      );

      expect(violations).toContainEqual(
        expect.objectContaining({
          kind: 'reverse-edge',
          message: expect.stringContaining(rule),
        }),
      );
    },
  );

  it('allows a documented reverse edge but rejects an additional one', () => {
    const root = fixture({
      'components/first.ts': 'export const first = 1;\n',
      'lib/use-first.ts':
        "import { first } from '../components/first';\nexport const value = first;\n",
    });
    const initial = analyzeArchitecture({ rootDir: root });
    const debt = createArchitectureDebt(initial);
    expect(findArchitectureViolations(initial, debt)).toEqual([]);

    writeFixture(
      root,
      'components/second.ts',
      'export const second = 2;\n',
    );
    writeFixture(
      root,
      'lib/use-second.ts',
      "import { second } from '../components/second';\nexport const value = second;\n",
    );

    expect(
      checkArchitecture({ rootDir: root, debt }).violations,
    ).toContainEqual(expect.objectContaining({ kind: 'reverse-edge' }));
  });

  it('ignores tests and generated modules when building the graph', () => {
    const root = fixture({
      'lib/live.ts': 'export const live = true;\n',
      'lib/__tests__/a.test.ts':
        "import { b } from './b.test';\nexport const a = b;\n",
      'lib/__tests__/b.test.ts':
        "import { a } from './a.test';\nexport const b = a;\n",
      'lib/generated/a.ts':
        "import { b } from './b';\nexport const a = b;\n",
      'lib/generated/b.ts':
        "import { a } from './a';\nexport const b = a;\n",
    });

    const analysis = analyzeArchitecture({ rootDir: root });

    expect(analysis.modules).toEqual(['lib/live.ts']);
    expect(analysis.cycles).toEqual([]);
  });

  it('returns a failing exit code from explicit check mode for a fixture violation', () => {
    const root = fixture({
      'lib/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'lib/b.ts': "import { a } from './a';\nexport const b = a;\n",
      'config/debt.json': `${JSON.stringify(emptyDebt())}\n`,
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(
      runArchitectureCli([
        '--check',
        `--root=${root}`,
        '--debt=config/debt.json',
      ]),
    ).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('新的模块循环'));

    stderr.mockRestore();
  });
});

describe('long-function debt gate', () => {
  it('detects a new function above the configured threshold', () => {
    const root = fixture({ 'lib/huge.ts': longFunction(8) });
    const analysis = analyzeArchitecture({
      rootDir: root,
      longFunctionThreshold: 5,
    });

    expect(findArchitectureViolations(analysis, emptyDebt(5))).toContainEqual(
      expect.objectContaining({ kind: 'new-long-function' }),
    );
  });

  it('uses a stable function identity when lines move outside the function', () => {
    const root = fixture({ 'lib/huge.ts': longFunction(8) });
    const initial = analyzeArchitecture({
      rootDir: root,
      longFunctionThreshold: 5,
    });
    const debt = createArchitectureDebt(initial);
    const initialId = initial.longFunctions[0]?.id;

    writeFixture(root, 'lib/huge.ts', `${'\n'.repeat(40)}${longFunction(8)}`);
    const moved = checkArchitecture({ rootDir: root, debt });

    expect(moved.analysis.longFunctions[0]?.id).toBe(initialId);
    expect(moved.violations).toEqual([]);
  });

  it('rejects growth inside an existing long function', () => {
    const root = fixture({ 'lib/huge.ts': longFunction(8) });
    const initial = analyzeArchitecture({
      rootDir: root,
      longFunctionThreshold: 5,
    });
    const debt = createArchitectureDebt(initial);

    writeFixture(root, 'lib/huge.ts', longFunction(9));

    expect(checkArchitecture({ rootDir: root, debt }).violations).toContainEqual(
      expect.objectContaining({ kind: 'long-function-growth' }),
    );
  });
});

function emptyDebt(longFunctionThreshold = 300): ArchitectureDebt {
  return {
    version: 1,
    longFunctionThreshold,
    allowedReverseEdges: [],
    longFunctions: [],
  };
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'print-shop-architecture-'));
  fixtureRoots.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    writeFixture(root, relativePath, source);
  }
  return root;
}

function writeFixture(root: string, relativePath: string, source: string): void {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

function longFunction(bodyLines: number): string {
  const body = Array.from(
    { length: bodyLines },
    (_, index) => `  const value${index} = ${index};`,
  ).join('\n');
  return `export function huge() {\n${body}\n  return value0;\n}\n`;
}
