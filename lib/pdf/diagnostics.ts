import { randomUUID } from 'node:crypto';
import { pdfFailure } from './status-response';

/** Never log a renderer exception, path, payload, URL or caller-supplied identifier. */
export function logPdfFailure(error: unknown, context: {
  mode: 'direct' | 'queued' | 'probe'; stage: 'render' | 'probe'; started: number;
}) {
  const failure = pdfFailure(error instanceof Error ? error.name : null);
  const requestId = randomUUID();
  console.error('[pdf] failure', {
    requestId, code: failure.code, mode: context.mode, stage: context.stage,
    elapsedMs: Math.max(0, Math.round(performance.now() - context.started)),
  });
  return { ...failure, requestId };
}
