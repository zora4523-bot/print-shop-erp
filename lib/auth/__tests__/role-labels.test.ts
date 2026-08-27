import { describe, expect, it } from 'vitest';
import type {
  BillStatus,
  MachineType,
  ProductCategory,
  Role,
  WorkerType,
} from '@/generated/prisma/enums';
import {
  billStatusLabel,
  machineTypeLabel,
  productCategoryLabel,
  roleLabel,
  workerTypeLabel,
} from '../role-labels';

describe('business labels', () => {
  it('does not expose unknown enum tokens to business users', () => {
    expect(roleLabel('RAW_ROLE' as Role)).toBe('未识别角色');
    expect(workerTypeLabel('RAW_WORKER_TYPE' as WorkerType)).toBe(
      '未识别岗位',
    );
    expect(machineTypeLabel('RAW_MACHINE' as MachineType)).toBe(
      '未识别机型',
    );
    expect(productCategoryLabel('RAW_CATEGORY' as ProductCategory)).toBe(
      '未识别产品分类',
    );
    expect(billStatusLabel('RAW_BILL_STATUS' as BillStatus)).toBe(
      '未识别账单状态',
    );
  });
});
