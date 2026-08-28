// Used from both server and client components, so import enums from the
// runtime-free /enums entry to avoid dragging Prisma into client bundles.
import {
  Role,
  WorkerType,
  MachineType,
  ProductCategory,
  BillStatus,
} from '../../generated/prisma/enums';

// Canonical Chinese label for each Role enum. Keep in sync with SPEC §2.1.
export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: '管理员',
  [Role.SALES]: '外部销售',
  [Role.CUSTOMER_SERVICE]: '内部销售/客服',
  [Role.WORKER]: '师傅',
};

export const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  [WorkerType.MACHINE]: '开机师傅',
  [WorkerType.PACKER]: '打包工',
  [WorkerType.CLEANER]: '清废工',
  [WorkerType.COOK]: '厨师',
};

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  [MachineType.HAND_PRESS]: '开机仔',
  [MachineType.WINDMILL]: '风车机',
  [MachineType.GLUE]: '黏封机',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? '未识别角色';
}

export function workerTypeLabel(workerType: WorkerType | null | undefined): string {
  return workerType ? (WORKER_TYPE_LABELS[workerType] ?? '未识别岗位') : '';
}

export function machineTypeLabel(machineType: MachineType | null | undefined): string {
  return machineType ? (MACHINE_TYPE_LABELS[machineType] ?? '未识别机型') : '';
}

// TODO: 需业主确认 —— 这些中文标签是根据 enum 名猜的，Prisma schema 里没有
// 文字说明。业主过一眼 /owner/rules/stock-skus 列表后告知更准的命名。
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  [ProductCategory.BLANK_STOCK]: '空白现货',
  [ProductCategory.GENERIC_STOCK]: '通版现货',
  [ProductCategory.CUSTOM_FLAT_FOIL]: '专版烫金',
  [ProductCategory.COLOR_PRINT]: '彩印',
  [ProductCategory.STOCK_FOIL_ADD]: '现货加烫',
  [ProductCategory.BYO_MATERIAL]: '自带纸料',
};

export function productCategoryLabel(category: ProductCategory): string {
  return PRODUCT_CATEGORY_LABELS[category] ?? '未识别产品分类';
}

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  [BillStatus.DRAFT]: '草稿',
  [BillStatus.ISSUED]: '已发单',
  [BillStatus.PARTIAL_PAID]: '部分结清',
  [BillStatus.FULLY_PAID]: '已结清',
};

export function billStatusLabel(status: BillStatus): string {
  return BILL_STATUS_LABELS[status] ?? '未识别账单状态';
}
