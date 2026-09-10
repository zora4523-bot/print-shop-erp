import { StatusBadge } from '@/components/ui-business';
import { opsReadinessDefinition } from '@/lib/ui/status-registry';

// 运维就绪徽章。就绪态不是持久化枚举，而是由 (ready, blockers) 派生的
// 三态展示值，映射集中在 lib/ui/status-registry.ts 的
// opsReadinessDefinition，避免各运维页各写一份 tone 判断。
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
