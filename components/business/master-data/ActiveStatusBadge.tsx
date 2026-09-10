import { StatusBadge } from '@/components/ui-business';
import { activeStatusDefinition } from '@/lib/ui/status-registry';

/**
 * 启停两态徽章——账号、客户/供应商、物料、产品分类等主数据共用同一个
 * `isActive` 布尔列。文案与色调由 lib/ui/status-registry 单点定义（§6），
 * 调用方不再传 label，也不再有第二套 tone。
 *
 * 与同目录的 ActiveStateConfirmButton 归在一起：两者都是跨实体启停 UI，
 * 被 account / party / material / product-category 等多个域引用。
 *
 * 不带 dot：启停是稳态，dot 在本仓库只留给「进行中」类状态。
 */
export function ActiveStatusBadge({ active }: { active: boolean }) {
  const definition = activeStatusDefinition(active);
  return <StatusBadge tone={definition.tone}>{definition.label}</StatusBadge>;
}
