'use client';

import { Button } from '@/components/ui/button';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

// Keep the strictly validated dialog element inside the same client boundary.
export function ConfirmationExamples() {
  return (
    <div className="flex flex-wrap gap-3">
      <ConfirmActionController level="L2"
        trigger={<Button variant="outline">停用通知群</Button>}>
        <ConfirmActionDialog action="停用“生产通知群”？" changes={[]} consequences={[
          '新通知不会再投递到该群。',
          '历史投递日志仍会保留。',
        ]} confirmText="确认停用" />
      </ConfirmActionController>
      <ConfirmActionController level="L3"
        trigger={<Button variant="destructive">作废结算结果</Button>}>
        <ConfirmActionDialog action="作废这份结算结果？" changes={[]} consequences={[
          '当前结算结果将不再作为付款依据。',
          '需要重新核算后才能继续后续流程。',
        ]} confirmText="填写理由并作废" />
      </ConfirmActionController>
    </div>
  );
}
