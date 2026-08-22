import { describe, expect, it } from 'vitest';
import { backgroundJobsMode } from '../mode';

describe('backgroundJobsMode', () => {
  it('defaults production to durable and non-production to inline', () => {
    expect(backgroundJobsMode({ NODE_ENV: 'production' })).toBe('durable');
    expect(backgroundJobsMode({ NODE_ENV: 'development' })).toBe('inline');
    expect(backgroundJobsMode({ NODE_ENV: 'test' })).toBe('inline');
  });

  it('allows an explicit rollout override', () => {
    expect(
      backgroundJobsMode({ NODE_ENV: 'production', BACKGROUND_JOBS_MODE: 'inline' }),
    ).toBe('inline');
    expect(
      backgroundJobsMode({ NODE_ENV: 'development', BACKGROUND_JOBS_MODE: 'durable' }),
    ).toBe('durable');
  });
});
