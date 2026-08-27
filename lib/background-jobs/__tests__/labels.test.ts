import { describe, expect, it } from 'vitest';
import { BackgroundJobQueue } from '@/generated/prisma/enums';
import {
  backgroundJobQueueLabel,
  backgroundJobTypeLabel,
} from '../labels';
import { BACKGROUND_JOB_TYPES } from '../types';

describe('background job business labels', () => {
  it('隐藏任务类型和队列的原始值', () => {
    expect(backgroundJobTypeLabel(BACKGROUND_JOB_TYPES.ORDER_EXPORT)).toBe(
      '导出工单',
    );
    expect(backgroundJobQueueLabel(BackgroundJobQueue.LIGHT)).toBe('常规');
    expect(backgroundJobQueueLabel(BackgroundJobQueue.HEAVY)).toBe('大文件');
    for (const type of Object.values(BACKGROUND_JOB_TYPES)) {
      expect(backgroundJobTypeLabel(type)).not.toBe('未识别任务');
    }
  });

  it('对未知值使用稳定业务回退', () => {
    expect(backgroundJobTypeLabel('RAW_UNKNOWN')).toBe('未识别任务');
    expect(backgroundJobQueueLabel('RAW_UNKNOWN')).toBe('未识别队列');
  });
});
