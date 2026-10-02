import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { devProcesses, devListenOptions } from '../dev-stack.mjs';
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

it.each([
  ['--port', '3137', '--hostname', '0.0.0.0'], ['--port=3137', '--hostname=0.0.0.0'],
  ['-p3137', '-H0.0.0.0'], ['-p', '3137', '-H', '0.0.0.0'],
  ['--port=3100', '-p3137', '--hostname=localhost', '-H0.0.0.0'],
])('preflights exactly the final Next address for %j', (...args) => {
  const result = devListenOptions(args, { PORT: '9999' });
  expect(result).toEqual({ port: 3137, host: '0.0.0.0', webArgs: args });
  expect(devProcesses('inline', result.webArgs)[0].args).toEqual(['node_modules/next/dist/bin/next', 'dev', ...args]);
});
it('inserts defaults before the option terminator', () => {
  expect(devListenOptions(['--', 'project'], { PORT: '3138' })).toEqual({ port: 3138, host: '127.0.0.1', webArgs: ['--port', '3138', '--hostname', '127.0.0.1', '--', 'project'] });
});
it.each([['--port='], ['--port'], ['-p0'], ['--port=65536'], ['--hostname=']])('rejects invalid address flags %j', (...args) => {
  expect(() => devListenOptions(args, {})).toThrow(/INVALID_/);
});
