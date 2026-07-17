import { describe, expect, it, vi } from 'vitest';

vi.mock('../cdr', () => ({ handleCdrBundleJob: vi.fn() }));
vi.mock('../cron', () => ({ handleCronJob: vi.fn() }));
vi.mock('../notification', () => ({ handleNotificationJob: vi.fn() }));
vi.mock('../pdf', () => ({ handleOrderPdfJob: vi.fn() }));

import { backgroundJobHandlers } from '../handlers';
import { BACKGROUND_JOB_TYPES } from '../types';

describe('backgroundJobHandlers', () => {
  it('registers every declared background job type', () => {
    expect(Object.keys(backgroundJobHandlers).sort()).toEqual(
      Object.values(BACKGROUND_JOB_TYPES).sort(),
    );
    expect(Object.values(backgroundJobHandlers)).not.toContain(undefined);
  });
});
