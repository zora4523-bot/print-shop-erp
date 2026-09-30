#!/usr/bin/env node
// Real Next build/start + an isolated PM2 daemon. No application database or user data.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pm2 = process.env.PDF_TEST_PM2_CLI;
assert.ok(pm2, 'Set PDF_TEST_PM2_CLI to an installed pm2 bin/pm2 path');
const fixture = await mkdtemp(path.join(tmpdir(), 'erp-pdf-shutdown-'));
const env = { ...process.env, NODE_ENV: 'production', PM2_HOME: path.join(fixture, 'pm2'), NEXT_TELEMETRY_DISABLED: '1' };
const runPm2 = (...args) => exec(process.execPath, [pm2, ...args], { env, timeout: 45000, maxBuffer: 1024 * 1024 });
const deadline = async (check, ms = 10000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); }
  assert.fail('Condition deadline exceeded');
};
let imageReached;
const reached = new Promise((resolve) => { imageReached = resolve; });
let ordinaryReached;
const ordinary = new Promise((resolve) => { ordinaryReached = resolve; });
const images = createServer((request, response) => {
  if (request.url === '/ordinary') { ordinaryReached(); response.end('ready'); }
  else imageReached();
});
await new Promise((resolve) => images.listen(0, '127.0.0.1', resolve));
const imagePort = images.address().port;
// Reserve then release an ephemeral localhost port for this isolated Next instance.
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
await mkdir(path.join(fixture, 'app/api/pdf'), { recursive: true });
await symlink(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'pdf-shutdown-fixture', private: true }));
await writeFile(path.join(fixture, 'next.config.mjs'), "export default { serverExternalPackages: ['puppeteer'] };\n");
await writeFile(path.join(fixture, 'app/layout.js'), 'export default function Layout({ children }) { return <html><body>{children}</body></html> }');
await writeFile(path.join(fixture, 'app/page.js'), 'export default function Page() { return <p>PDF shutdown fixture</p> }');
await writeFile(path.join(fixture, 'app/api/pdf/route.js'), `
import { renderDirectOrderPdf } from ${JSON.stringify(path.join(root, 'lib/pdf/direct.ts'))};
export const runtime = 'nodejs';
export async function GET(req) {
 const slow = new URL(req.url).searchParams.has('slow');
 try {
  const bytes = await renderDirectOrderPdf({ orderId: 'fixture', actorId: 'fixture', actorRole: 'ADMIN',
   snapshotKey: slow ? 'slow' : 'fast', baseUrl: 'http://localhost', signal: req.signal, regenerate: true,
   html: async () => '<html><body>PDF shutdown' + (slow ? '<img src="http://127.0.0.1:${imagePort}/never">' : '') + '<script>document.documentElement.dataset.printReady="true"</script></body></html>' });
  return new Response(new Uint8Array(bytes));
 } catch { return new Response('unavailable', { status: 503 }); }
}
`);
await mkdir(path.join(fixture, 'app/api/ordinary'), { recursive: true });
await writeFile(path.join(fixture, 'app/api/ordinary/route.js'), `
export async function GET() {
 await fetch('http://127.0.0.1:${imagePort}/ordinary');
 await new Promise((resolve) => setTimeout(resolve, 2000));
 return new Response('ordinary completed');
}
`);
const next = path.join(root, 'node_modules/next/dist/bin/next');
let started = false;
try {
  const build = await exec(process.execPath, [next, 'build', '--webpack'], { cwd: fixture, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  await writeFile(path.join(fixture, 'build.log'), build.stdout + build.stderr);
  await runPm2('start', next, '--name', 'pdf-shutdown-fixture', '--cwd', fixture, '--kill-timeout', '30000', '--', 'start', '--hostname', '127.0.0.1', '--port', String(port));
  started = true;
  const url = `http://127.0.0.1:${port}`;
  await deadline(async () => { try { return (await fetch(url)).ok; } catch { return false; } });
  assert.equal((await fetch(`${url}/api/pdf`)).status, 200);
  const before = JSON.parse((await runPm2('jlist')).stdout)[0];
  const listing = (await exec('ps', ['-axo', 'pid=,ppid=,comm='])).stdout;
  const ownedBrowsers = listing.split('\n').map((line) => line.trim().split(/\s+/)).filter((line) => Number(line[1]) === before.pid && line.slice(2).join(' ').includes('Chrome')).map((line) => Number(line[0]));
  assert.ok(ownedBrowsers.length > 0, 'Locate only this Next instance’s Chromium');
  const pending = fetch(`${url}/api/pdf?slow=1`, { signal: AbortSignal.timeout(35000) });
  await Promise.race([reached, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Image request not reached')), 10000); timer.unref(); })]);
  // A normal request must remain responsive while a PDF is waiting on its image.
  assert.equal((await fetch(url)).status, 200);
  const ordinaryRequest = fetch(`${url}/api/ordinary`);
  await ordinary;
  const start = performance.now();
  const reload = runPm2('reload', 'pdf-shutdown-fixture');
  assert.equal((await pending).status, 503);
  assert.equal((await ordinaryRequest).status, 200);
  await reload;
  const elapsedMs = Math.round(performance.now() - start);
  assert.ok(elapsedMs < 28000, 'Drain must finish before PM2’s 30-second hard kill');
  const after = JSON.parse((await runPm2('jlist')).stdout)[0];
  assert.notEqual(after.pid, before.pid);
  await deadline(async () => { try { return (await fetch(url)).ok; } catch { return false; } });
  assert.equal((await fetch(`${url}/api/pdf`)).status, 200);
  for (const pid of ownedBrowsers) {
    await assert.rejects(exec('pgrep', ['-g', String(pid)]), (error) => error.code === 1);
  }
  const pm2Log = await readFile(path.join(fixture, 'pm2/pm2.log'), 'utf8');
  assert.doesNotMatch(pm2Log, /SIGKILL/);
  // Next 16.3.4 deliberately exits 128 + signal after its cleanup completes.
  assert.match(pm2Log, /exited with code \[130\] via signal \[SIGINT\]/);
  console.log(JSON.stringify({ result: 'passed', elapsedMs, oldPid: before.pid, newPid: after.pid, evidence: fixture }));
} finally {
  if (started) await runPm2('delete', 'pdf-shutdown-fixture');
  await runPm2('kill');
  images.closeAllConnections(); images.close();
}
