import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { devProcesses } from '../dev-stack.mjs';
it('starts both workers with their required React conditions and preserves web arguments', () => {
  const processes = devProcesses('durable', ['--port', '3137']);
  expect(processes.map((p: { name: string }) => p.name)).toEqual(['LIGHT', 'HEAVY', 'web']);
  expect(processes[0].args).toContain('--conditions=react-server');
  expect(processes[1].args).not.toContain('--conditions=react-server');
  expect(processes[2].args).toEqual(['node_modules/next/dist/bin/next', 'dev', '--port', '3137']);
});
it('does not start workers in explicitly selected inline mode', () => {
  expect(devProcesses('inline').map((p: { name: string }) => p.name)).toEqual(['web']);
});

it('loads under the native Node ESM runtime used by pnpm dev', () => {
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', "const { devProcesses } = await import('./scripts/dev-stack.mjs'); console.log(devProcesses('durable').length)"], { encoding: 'utf8' }).trim()).toBe('3');
});
