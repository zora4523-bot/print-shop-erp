import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { PdfBrowserPool } from '../lib/pdf/browser-pool';
import { pdfLaunchOptions } from '../lib/pdf/launch-options';
import { renderHtmlToPdf } from '../lib/pdf/render';

/** Standalone fault injection. Only signals Chromium instances launched by this script. */
async function main() {
  assert.notEqual(process.platform, 'win32', 'Process group fault injection requires POSIX');
  const pids = new Set<number>();
  const pool = new PdfBrowserPool(() => puppeteer.launch(pdfLaunchOptions()), { cleanupMs: 1000, closeMs: 1000, exitMs: 3000 });
  const html = '<html><body>PDF recovery<script>document.documentElement.dataset.printReady="true"</script></body></html>';
  const render = (before?: (pid: number) => void, after?: (pid: number) => void) => pool.run(async (browser, context, signal) => {
    const pid = browser.process()?.pid;
    assert.ok(pid); pids.add(pid);
    before?.(pid);
    const bytes = await renderHtmlToPdf({ html, browser, context, signal });
    after?.(pid);
    return bytes;
  }, { budgetMs: 8000 });
  const validate = async (bytes: Buffer) => assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  try {
    await validate(await render());
    await assert.rejects(render((pid) => process.kill(-pid, 'SIGSTOP')));
    await validate(await render());
    await validate(await render(undefined, (pid) => process.kill(-pid, 'SIGSTOP')));
    await validate(await render());
    await assert.rejects(render((pid) => process.kill(pid, 'SIGKILL')));
    await validate(await render());
  } finally { await pool.close(); }
  // The parent exit is not proof that every helper has gone; inspect only owned groups.
  for (const pid of pids) {
    let remaining = '';
    try { remaining = execFileSync('pgrep', ['-g', String(pid)], { encoding: 'utf8' }); }
    catch (error) { assert.equal((error as { status: number }).status, 1); }
    assert.equal(remaining, '', `Owned Chromium group ${pid} still exists`);
  }
  console.info('[pdf-lifecycle-check] freeze, crash, cleanup and subsequent PDF recovery passed');
}
main().catch(() => { console.error('[pdf-lifecycle-check] failed; inspect owned child processes'); process.exitCode = 1; });
