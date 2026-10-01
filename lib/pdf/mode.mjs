/** Shared by runtime and the plain Node deployment check. Invalid configuration fails closed. */
/** @param {Readonly<Record<string, string | undefined>>} env */
export function orderPdfMode(env = process.env) {
  const mode = env.PDF_ORDER_MODE;
  if (!mode && env.NODE_ENV !== 'production') return 'direct';
  if (mode === 'direct') return mode;
  if (mode === 'queued' && (env.BACKGROUND_JOBS_MODE === 'durable' ||
    (!env.BACKGROUND_JOBS_MODE && env.NODE_ENV === 'production'))) return mode;
  return null;
}
