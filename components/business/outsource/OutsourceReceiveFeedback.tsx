import type { OutsourceMutationResult } from '@/actions/outsource.types';
import { ActionNotice } from '@/components/ui-business';

export function OutsourceReceiveFeedback({
  state,
}: {
  state: OutsourceMutationResult | null;
}) {
  if (state?.status === 'success' && state.notice) {
    return (
      <ActionNotice
        tone="warning"
        title="已标记回货，但工单尚未生产完工"
        description={state.notice}
      />
    );
  }
  if (state?.status === 'success') {
    return (
      <ActionNotice
        tone="success"
        title="外协单已标记回货"
        description="系统已重新核对关联工单的生产完工条件。"
      />
    );
  }
  if (state?.status === 'error') {
    return (
      <ActionNotice
        tone="error"
        title="外协单未标记回货"
        description={state.message}
      />
    );
  }
  if (state?.status === 'invalid') {
    return (
      <ActionNotice
        tone="error"
        title="请检查回货信息"
        description={Object.values(state.fieldErrors).flat().join('；')}
      />
    );
  }
  return null;
}
