import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { logPdfFailure } from './diagnostics';

export const PDF_JOB_TYPES = [BACKGROUND_JOB_TYPES.ORDER_PDF, BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF] as const;
/** Healthy probes render in Chromium and round-trip OSS; keep them well above the pool idle window. */
export const PDF_PROBE_HEALTHY_INTERVAL_MS = 300_000;
export const PDF_PROBE_RETRY_MS = 10_000;
/** Longer than the healthy interval so readiness never lapses between successful probes. */
export const PDF_READY_TTL_MS = PDF_PROBE_HEALTHY_INTERVAL_MS + 60_000;

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
        readyUntil = Date.now() + PDF_READY_TTL_MS;
        failures = 0;
      }
    }, (error: unknown) => {
      readyUntil = 0;
      failures++;
      logPdfFailure(error, { mode: 'probe', stage: 'probe', started });
    }).finally(() => {
      inFlight = undefined;
      if (!stopped) {
        // Invalidated during the probe: its success was discarded, so retry soon.
        const delay = failures
          ? Math.min(60_000, PDF_PROBE_RETRY_MS * 2 ** Math.min(failures - 1, 3))
          : generation !== expectedGeneration ? PDF_PROBE_RETRY_MS : PDF_PROBE_HEALTHY_INTERVAL_MS;
        timer = setTimeout(run, delay);
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
      if (!inFlight && !stopped) { clearTimeout(timer); timer = setTimeout(run, PDF_PROBE_RETRY_MS); timer.unref(); }
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
