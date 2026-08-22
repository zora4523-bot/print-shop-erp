export type BackgroundJobsMode = 'inline' | 'durable';

export function backgroundJobsMode(
  env: NodeJS.ProcessEnv = process.env,
): BackgroundJobsMode {
  if (env.BACKGROUND_JOBS_MODE === 'durable') return 'durable';
  if (env.BACKGROUND_JOBS_MODE === 'inline') return 'inline';
  return env.NODE_ENV === 'production' ? 'durable' : 'inline';
}
