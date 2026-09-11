import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('scripts/agent-next-task.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(backlog: string, args: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'erp-agent-next-'));
  roots.push(root);
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs/AGENT-BACKLOG.md'), backlog);
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

function task(id: string, priority: string, status = 'agent-ready') {
  return `## ${id} - ${id} fixture\n\n- Status: \`${status}\`\n- Priority: ${priority}\n- Suggested branch: \`codex/${id.toLowerCase()}\`\n`;
}

describe('agent:next generated execution contract', () => {
  it('selects the highest-priority ready task and preserves file order for ties', () => {
    const result = run(task('A01', 'P2') + task('A02', 'P0', 'done') + task('A03', 'P1') + task('A04', 'P1'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Implement only A03.');
    expect(result.stdout).toContain('Create or use branch codex/a03.');
    expect(result.stdout).not.toContain('## A01');
    expect(result.stdout).not.toContain('## A04');
  });

  it('points to current risk, isolation and release gates instead of legacy shortcuts', () => {
    const result = run(task('A01', 'P1'));
    expect(result.status).toBe(0);
    for (const requirement of [
      'CONTRIBUTING.md#测试要求', 'DEVELOPMENT.md#常用命令', 'DEVELOPMENT.md#测试环境约束',
      'docs/编码规范.md', 'pnpm lint', 'pnpm typecheck', 'pnpm test --run',
      'pnpm build', 'pnpm test:browser', 'pnpm test:migrations:fresh',
      'E2E_DATABASE_URL distinct from the daily DATABASE_URL',
      'Playwright --list only collects tests', 'actual pass/fail/skip counts',
      'production dependency audit', 'Never lower gates or update visual baselines merely to pass',
    ]) expect(result.stdout).toContain(requirement);
    expect(result.stdout).not.toContain('./node_modules/.bin/eslint .');
    expect(result.stdout).not.toContain('--testTimeout=10000');
    expect(result.stdout).toContain('Do not execute production database operations or destructive git commands.');
    expect(result.stdout).toContain('open a draft PR');
  });

  it('lists all tasks without issuing an implementation prompt', () => {
    const result = run(task('A01', 'P1') + task('A02', 'P0', 'done'), ['--list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('A01\tagent-ready\tP1\tA01 fixture\nA02\tdone\tP0\tA02 fixture\n');
    expect(result.stdout).not.toContain('Execution rules');
  });

  it('fails explicitly when no ready task is available', () => {
    const result = run(task('A01', 'P1', 'needs-owner-input'));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No agent-ready task found');
  });
});
