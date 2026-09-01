import { assertExecutionFence, type ExecutionFence } from '../execution-fence';
import type { dispatchNotification } from '../notification/dispatch';
import {
  scanPendingFactoryBacklog,
  type PendingFactoryBacklogCandidate,
} from '../order/pending-factory-backlog-scan';

type PendingFactoryBacklogTaskDependencies = {
  configuration(): Promise<{ enabled: boolean; threshold: number }>;
  scan(threshold: number): Promise<PendingFactoryBacklogCandidate | null>;
  dispatch: typeof dispatchNotification;
};

const defaultDependencies: PendingFactoryBacklogTaskDependencies = {
  configuration: async () => {
    const { getSetting } = await import('../settings');
    const [toggle, threshold] = await Promise.all([
      getSetting('notify_pending_factory_backlog_enabled'),
      getSetting('pending_factory_backlog_threshold'),
    ]);
    return { enabled: toggle.enabled, threshold: threshold.count };
  },
  scan: scanPendingFactoryBacklog,
  dispatch: async (...args) => {
    const notification = await import('../notification/dispatch');
    return notification.dispatchNotification(...args);
  },
};

export async function runPendingFactoryBacklogTask(
  runDate: string,
  fence?: ExecutionFence,
  dependencies: PendingFactoryBacklogTaskDependencies = defaultDependencies,
) {
  const configuration = await dependencies.configuration();
  if (!configuration.enabled) {
    return {
      status: 'ok' as const,
      runDate,
      enabled: false,
      pendingCount: 0,
      notified: false,
    };
  }

  await assertExecutionFence(fence);
  const candidate = await dependencies.scan(configuration.threshold);
  if (!candidate) {
    return {
      status: 'ok' as const,
      runDate,
      enabled: true,
      pendingCount: 0,
      notified: false,
    };
  }

  await assertExecutionFence(fence);
  await dependencies.dispatch(
    'PENDING_FACTORY_BACKLOG',
    {
      orderId: candidate.representativeOrder.id,
      orderNo: candidate.representativeOrder.orderNo,
      summary: `当前待工厂确认 ${candidate.count} 单，已达到提醒阈值 ${candidate.threshold} 单`,
      deepLink: `/orders#wo=${encodeURIComponent(candidate.representativeOrder.orderNo)}`,
    },
    {
      // One aggregate occurrence per Shanghai day. Count/anchor changes during
      // a retry must not create a second WeCom message.
      dedupeKey: `notification:PENDING_FACTORY_BACKLOG:${runDate}`,
    },
  );

  return {
    status: 'ok' as const,
    runDate,
    enabled: true,
    pendingCount: candidate.count,
    notified: true,
  };
}
