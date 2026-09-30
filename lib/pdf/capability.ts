import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { logPdfFailure } from './diagnostics';

export const PDF_JOB_TYPES = [BACKGROUND_JOB_TYPES.ORDER_PDF, BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF] as const;
const READY_TTL_MS = 120_000;

/** One non-overlapping probe. Failure disables PDF claims without stopping other HEAVY work. */
export function startPdfCapabilityMonitor(probe: () => Promise<unknown>) {
  let readyUntil = 0;
  let failures = 0;
  let generation = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  const run = () => {
    const expectedGeneration = generation;
    const started = performance.now();
    inFlight = Promise.resolve().then(probe).then(() => {
      // A real job can fail while a probe is finishing. Its newer failure wins.
      if (generation === expectedGeneration && !stopped) {
        readyUntil = Date.now() + READY_TTL_MS;
        failures = 0;
      }
    }, (error: unknown) => {
      readyUntil = 0;
      failures++;
      logPdfFailure(error, { mode: 'probe', stage: 'probe', started });
    }).finally(() => {
      inFlight = undefined;
      if (!stopped) {
        timer = setTimeout(run, failures ? Math.min(60_000, 10_000 * 2 ** Math.min(failures - 1, 3)) : 60_000);
        timer.unref();
      }
    });
  };
  run();
  return {
    ready: () => !stopped && Date.now() < readyUntil,
    invalidate() {
      generation++;
      readyUntil = 0;
      if (!inFlight && !stopped) { clearTimeout(timer); timer = setTimeout(run, 10_000); timer.unref(); }
    },
    async stop() {
      stopped = true;
      readyUntil = 0;
      clearTimeout(timer);
      await inFlight;
    },
  };
}

export function isPdfInfrastructureFailure(error: unknown): boolean {
  return error instanceof Error && ['PdfBrowserUnavailableError', 'PrintFontUnavailableError',
    'PDF_BROWSER_VERSION_MISMATCH', 'PdfArtifactStorageError', 'TargetCloseError', 'ProtocolError'].includes(error.name);
}
