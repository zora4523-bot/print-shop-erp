import { StatusBadge } from '@/components/ui-business';
import { opsReadinessDefinition } from '@/lib/ui/status-registry';

// 运维就绪状态由 ready 与 blockers 派生，统一通过 opsReadinessDefinition 映射展示。
export function OpsReadinessBadge({
  ready,
  blockers,
}: {
  ready: boolean;
  blockers: readonly string[];
}) {
  const definition = opsReadinessDefinition(ready, blockers);
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
