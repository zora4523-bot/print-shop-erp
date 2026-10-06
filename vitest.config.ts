import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      '.next/**',
      'generated/**',
      'tests/e2e/**',
      'tests/visual/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/__tests__/**', 'lib/utils.ts'],
      // 门禁（DECISIONS 2026-08-19）。此前 §4.3 写着「100% 覆盖」，但
      // @vitest/coverage-v8 根本没装、这条命令跑不起来，所以指标从未被
      // 机器校验过——这正是它能长期漂到 89% 的原因。
      //
      // 分两档：
      //   1. 算钱的纯函数 + 全部状态机 → 100%，一行都不许掉。它们算错
      //      就是发错工资 / 报错价 / 绕过状态流转。这 8 个文件今天实测
      //      就是 100%，阈值只是把它钉住。
      //   2. 其余 lib/**（多是读路径与管理 CRUD）→ 按当前水位设，只防
      //      倒退，不逼着为 UI 查询函数补测试。水位来自 2026-08-19 实测
      //      84.43 / 76.79 / 89.71 / 86.65，各留 1 个百分点余量。
      thresholds: {
        'lib/salary/daily-minimum.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'lib/production/completion-wage.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'lib/order/admin-create-price.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'lib/order/shipment-box-pricing.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'lib/salary/piecework-pricing.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'lib/**/status-machine.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        statements: 83,
        branches: 75,
        functions: 88,
        lines: 85,
      },
    },
  },
});
