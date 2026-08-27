import { BackgroundJobQueue } from '../../generated/prisma/enums';
import { BACKGROUND_JOB_TYPES } from './types';

const JOB_TYPE_LABELS: Record<string, string> = {
  [BACKGROUND_JOB_TYPES.NOTIFICATION]: '通知投递',
  [BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY]: '生成师傅日薪',
  [BACKGROUND_JOB_TYPES.CRON_HOURLY_PAYROLL]: '生成时薪月结',
  [BACKGROUND_JOB_TYPES.CRON_CS_SETTLE]: '结算客服周期',
  [BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS]: '生成月账单',
  [BACKGROUND_JOB_TYPES.CRON_OUTSOURCE_OVERDUE]: '检查外协超期',
  [BACKGROUND_JOB_TYPES.CRON_CS_PERIOD_ENDING]: '检查客服周期',
  [BACKGROUND_JOB_TYPES.CRON_ORDER_OVERDUE]: '检查工单逾期',
  [BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP]: '清理过期导出',
  [BACKGROUND_JOB_TYPES.CDR_BUNDLE]: '整理设计文件',
  [BACKGROUND_JOB_TYPES.ORDER_PDF]: '生成工单 PDF',
  [BACKGROUND_JOB_TYPES.ORDER_EXPORT]: '导出工单',
};

export function backgroundJobTypeLabel(type: string): string {
  return JOB_TYPE_LABELS[type] ?? '未识别任务';
}

export function backgroundJobQueueLabel(queue: string): string {
  if (queue === BackgroundJobQueue.LIGHT) return '常规';
  if (queue === BackgroundJobQueue.HEAVY) return '大文件';
  return '未识别队列';
}
