import { StatusBadge } from '@/components/ui-business';
import { sensitiveColumnMaskingDefinition } from '@/lib/ui/status-registry';

// 敏感列脱敏就绪徽章。与运维就绪态同理：展示态由
// (maskingStrategy, anonLabelApplied) 派生，映射集中在
// lib/ui/status-registry.ts，页面不再自带 tone / 文案三元。
export function SensitiveColumnMaskingBadge({
  maskingStrategy,
  anonLabelApplied,
}: {
  maskingStrategy: string;
  anonLabelApplied: boolean;
}) {
  const definition = sensitiveColumnMaskingDefinition(
    maskingStrategy,
    anonLabelApplied,
  );
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
