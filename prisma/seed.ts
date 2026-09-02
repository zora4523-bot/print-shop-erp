/**
 * 种子数据初始化
 *
 * 运行：pnpm prisma db seed
 *
 * 包含：
 * 1. 默认管理员账号
 * 2. 工艺字典默认项
 * 3. 薪资规则默认值（三套体系）
 * 3A. 新工序计件价簿占位（DRAFT / null）
 * 4. 推送事件类型预置
 * 5. 系统配置
 *
 * 注意：Prisma 7 的 client 从 ./generated/prisma 导入，不是 @prisma/client
 */

import { randomBytes } from 'node:crypto';
import {
  PrismaClient,
  Role,
  WorkerType,
  MachineType,
} from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import {
  RETIRED_SETTING_KEYS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
} from '../lib/settings/definitions';
import { seedPieceworkPriceBookV1Placeholder } from '../lib/salary/piecework-price-book-seed';
import { NOTIFICATION_EVENTS } from '../lib/notification/events';

// Prisma 7 要求显式指定 adapter
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 开始种子数据初始化...');

  await seedAdmin();
  await seedCrafts();
  await seedSalaryRules();
  await seedPieceworkPriceBook();
  await seedNotificationEvents();
  await seedSettings();

  console.log('✅ 种子数据初始化完成');
}

// ============================================================
// 1. 管理员账号
// ============================================================
async function seedAdmin() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const fromEnv = process.env.SEED_ADMIN_PASSWORD;
  const existing = await db.user.findUnique({ where: { username } });

  // ── Branch 1: the target username already exists ────────────────────────
  if (existing) {
    // Non-admin collision: refuse — silently promoting a WORKER/SALES/etc to
    // ADMIN would be a privilege leak.
    if (existing.role !== Role.ADMIN) {
      throw new Error(
        `SEED_ADMIN_USERNAME "${username}" 已被非管理员账号占用（role=${existing.role}）；` +
          '拒绝将已有账号静默提权为管理员。请换用其它 SEED_ADMIN_USERNAME。',
      );
    }

    // The row is already ADMIN. Separate password reset from reactivation.
    if (fromEnv) {
      const hashed = await bcrypt.hash(fromEnv, 10);

      if (existing.isActive) {
        // Pure password reset — the row is already an active administrator.
        await db.user.update({
          where: { id: existing.id },
          data: { password: hashed },
        });
        console.log(`  🔑 已重置活跃管理员 ${username} 的密码（来自 SEED_ADMIN_PASSWORD）`);
        return;
      }

      // Do not silently reactivate a dormant administrator when another active
      // administrator already exists under a different username.
      const otherActiveAdmins = await db.user.count({
        where: { role: Role.ADMIN, isActive: true },
      });
      if (otherActiveAdmins > 0) {
        throw new Error(
          `既有 ${otherActiveAdmins} 位活跃管理员，拒绝同时将非活跃管理员 "${username}" 重新激活。` +
            '请先停用当前管理员再重跑 seed，或换用对应活跃管理员的用户名重置密码。',
        );
      }

      await db.user.update({
        where: { id: existing.id },
        data: { password: hashed, isActive: true },
      });
      console.log(`  🔑 已重置管理员 ${username} 的密码并重新激活（来自 SEED_ADMIN_PASSWORD）`);
      return;
    }

    if (existing.isActive) {
      console.log(`  ⏭  已有活跃管理员 ${username}，跳过管理员种子`);
    } else {
      throw new Error(
        `用户 "${username}" 已存在且 role=ADMIN（isActive=false）。` +
          '可选恢复路径：(1) DBA 直接 UPDATE isActive=true；' +
          '(2) 设置 SEED_ADMIN_PASSWORD 后重跑 seed，将自动重置密码并激活。',
      );
    }
    return;
  }

  // ── Branch 2: the target username does not exist ────────────────────────
  // Don't create a second administrator behind the back of an existing one
  // (e.g. the operator renamed the original admin but left the default
  // SEED_ADMIN_USERNAME in env — the fresh "admin" would silently become a
  // second ADMIN).
  const activeAdminCount = await db.user.count({
    where: { role: Role.ADMIN, isActive: true },
  });
  if (activeAdminCount > 0) {
    console.log(
      `  ⏭  已有 ${activeAdminCount} 位活跃管理员（与 SEED_ADMIN_USERNAME=${username} 不同名），跳过`,
    );
    return;
  }

  // First seed into an empty DB, or recovery after all administrators were removed.
  const generated = fromEnv ? null : randomBytes(12).toString('base64url');
  const plaintext = fromEnv ?? generated!;
  const hashed = await bcrypt.hash(plaintext, 10);

  await db.user.create({
    data: {
      username,
      password: hashed,
      role: Role.ADMIN,
      displayName: '管理员',
      isActive: true,
    },
  });

  if (generated) {
    console.log('');
    console.log('  ⚠  SEED_ADMIN_PASSWORD 未设置，已随机生成一次性密码：');
    console.log(`       用户名: ${username}`);
    console.log(`       密码:   ${generated}`);
    console.log('     仅此一次打印，请立刻保存并登录后修改。');
    console.log('');
  } else {
    console.log(`  ✓ 创建管理员 ${username}（密码来自 SEED_ADMIN_PASSWORD，登录后请修改）`);
  }
}

// ============================================================
// 2. 工艺字典
// ============================================================
async function seedCrafts() {
  const crafts = [
    // 自产工艺
    { name: '局部烫金', code: 'FLAT_FOIL_PARTIAL', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.HAND_PRESS, sortOrder: 10 },
    { name: '专版单色平烫', code: 'FLAT_FOIL_SINGLE', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, sortOrder: 20 },
    { name: '专版双色平烫', code: 'FLAT_FOIL_DOUBLE', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, sortOrder: 21 },
    { name: '专版三色平烫', code: 'FLAT_FOIL_TRIPLE', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, sortOrder: 22 },
    { name: '浮雕', code: 'EMBOSS', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, sortOrder: 30 },
    { name: '激凸', code: 'BUMP', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, sortOrder: 31 },
    { name: '粘封', code: 'GLUING', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.GLUE, sortOrder: 40 },
    { name: '打包/入袋', code: 'PACKING', isOutsource: false, defaultWorkerType: WorkerType.PACKER, defaultMachineType: null, sortOrder: 50 },

    // 外协工艺
    { name: '铜版纸纯彩印', code: 'COATED_COLOR_PRINT', isOutsource: true, defaultWorkerType: null, defaultMachineType: null, sortOrder: 60 },
    { name: '铜版纸彩印+烫金', code: 'COATED_COLOR_PRINT_FOIL', isOutsource: true, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, inHouseMachineTypes: [MachineType.HAND_PRESS, MachineType.WINDMILL], sortOrder: 61 },
    { name: '冰白彩印（纯印刷）', code: 'COLOR_PRINT', isOutsource: true, defaultWorkerType: null, defaultMachineType: null, sortOrder: 70 },
    { name: '冰白彩印（印刷+烫金）', code: 'COLOR_PRINT_FOIL', isOutsource: true, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.WINDMILL, inHouseMachineTypes: [MachineType.HAND_PRESS, MachineType.WINDMILL], sortOrder: 71 },

    // 低频工艺：录单页固定归到末尾分组
    { name: '现货加烫', code: 'STOCK_FOIL', isOutsource: false, defaultWorkerType: WorkerType.MACHINE, defaultMachineType: MachineType.HAND_PRESS, sortOrder: 900, isActive: false },
    { name: 'UV', code: 'UV', isOutsource: true, defaultWorkerType: null, defaultMachineType: null, sortOrder: 901 },
    { name: '啤（模切）', code: 'DIE_CUT', isOutsource: true, defaultWorkerType: null, defaultMachineType: null, sortOrder: 902 },
    { name: '清废', code: 'CLEANING', isOutsource: false, defaultWorkerType: WorkerType.CLEANER, defaultMachineType: null, sortOrder: 903 },
  ];

  // Seed 只补齐缺失的初始字典。名称、岗位、机型、排序和启用状态都可在
  // 规则中心维护，重跑 seed 不得把这些字段改回代码默认值。
  const { count: created } = await db.craft.createMany({
    data: crafts,
    skipDuplicates: true,
  });
  console.log(
    `  ✓ 工艺字典 ${crafts.length} 条（新建 ${created}，保留已有 ${crafts.length - created}）`,
  );
}

// ============================================================
// 3. 薪资规则
// ============================================================
async function seedSalaryRules() {
  const now = new Date();

  const rules = [
    // --- 客服提成规则 ---
    {
      ruleType: 'CS_COMMISSION' as const,
      ruleKey: 'CS_BASE_SALARY',
      ruleValue: { monthlyBase: 2000 },
      remark: '客服月底薪2000',
    },
    {
      ruleType: 'CS_COMMISSION' as const,
      ruleKey: 'CS_PERIOD_LENGTH',
      ruleValue: { months: 4 },
      remark: '客服业绩周期为4个月',
    },
    {
      ruleType: 'CS_COMMISSION' as const,
      ruleKey: 'CS_TIERS',
      ruleValue: {
        mode: 'FLAT',
        tiers: [
          { minSales: 100000, rate: 0.010 },
          { minSales: 200000, rate: 0.020 },
          { minSales: 300000, rate: 0.030 },
          { minSales: 400000, rate: 0.045 },
          { minSales: 500000, rate: 0.060 },
          { minSales: 600000, rate: 0.065 },
          { minSales: 700000, rate: 0.070 },
          { minSales: 800000, rate: 0.075 },
          { minSales: 900000, rate: 0.080 },
          { minSales: 1000000, rate: 0.085 },
        ],
      },
      remark: '客服提成档位表（FLAT模式）',
    },

    // --- 开机师傅规则 ---
    {
      ruleType: 'WORKER_MACHINE' as const,
      ruleKey: 'HAND_PRESS',
      ruleValue: {
        dailyBase: 100,
        pieceRate: 0.007,
        boardRate: 5,
        smallOrderThreshold: 1000,
        smallOrderFlatPrice: 12,
        multiplierFactors: ['DOUBLE_SIDED', 'DOUBLE_COLOR'],
      },
      remark: '开机仔计件规则',
    },
    {
      ruleType: 'WORKER_MACHINE' as const,
      ruleKey: 'WINDMILL',
      ruleValue: {
        dailyBase: 120,
        pieceRate: 0.01,
        boardRate: 0,
        smallOrderThreshold: 1000,
        smallOrderFlatPrice: 20,
        smallOrderInclusive: true,
        largeOrderSetupFee: 10,
        multiplierFactors: ['DOUBLE_COLOR'],
      },
      remark: '风车机师傅计件规则（1000 个及以下 20 元；以上每个 0.01 元 + 装板 10 元）',
    },
    {
      ruleType: 'WORKER_MACHINE' as const,
      ruleKey: 'GLUE',
      ruleValue: {
        dailyBase: 120,
        pieceRate: 0.002,
        boardRate: 0,
        smallOrderThreshold: null,
        smallOrderFlatPrice: null,
        multiplierFactors: [],
      },
      remark: '黏封机师傅计件规则',
    },

    // --- 时薪工规则 ---
    {
      ruleType: 'WORKER_HOURLY' as const,
      ruleKey: 'PACKER_HOURLY',
      ruleValue: { hourlyRate: 11 },
      remark: '打包工时薪（10-12元区间，默认11）',
    },
    {
      ruleType: 'WORKER_HOURLY' as const,
      ruleKey: 'CLEANER_HOURLY',
      ruleValue: { hourlyRate: 11 },
      remark: '清废工时薪',
    },
    {
      ruleType: 'WORKER_HOURLY' as const,
      ruleKey: 'COOK_SPARE_HOURLY',
      ruleValue: { hourlyRate: 11 },
      remark: '厨师打包兼职时薪',
    },
    {
      ruleType: 'WORKER_HOURLY' as const,
      ruleKey: 'OT_MULTIPLIER',
      ruleValue: { multiplier: 1.0 },
      remark: '加班倍率',
    },
    {
      ruleType: 'WORKER_HOURLY' as const,
      ruleKey: 'WORK_HOURS',
      ruleValue: {
        morning: { start: '08:00', end: '12:00' },
        afternoon: { start: '13:30', end: '17:30' },
        otStart: '18:00',
      },
      remark: '标准工时段',
    },

    // --- 厨师月薪 ---
    {
      ruleType: 'COOK_SALARY' as const,
      ruleKey: 'COOK_MONTHLY',
      ruleValue: { monthlyBase: 3000 },
      remark: '厨师月薪',
    },
  ];

  // 只有该 (ruleType, ruleKey) 在整个版本库中从未出现时，才写入首次
  // 部署默认值。即使仅剩已关闭的历史版本，也不在 seed 中自动“修复”；
  // 否则会绕过规则中心的版本、审计和生效时间语义。
  const created = await db.$transaction(async (tx) => {
    // 与规则中心写入使用同一把事务锁，防止首次部署时并发 seed
    // 或管理员创建版本导致同一默认键被初始化两次。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:salary-rules:snapshot'))`;

    const existing = await tx.salaryRule.findMany({
      where: {
        OR: rules.map((rule) => ({
          ruleType: rule.ruleType,
          ruleKey: rule.ruleKey,
        })),
      },
      select: { ruleType: true, ruleKey: true },
    });
    const existingKeys = new Set(
      existing.map((rule) => `${rule.ruleType}:${rule.ruleKey}`),
    );
    const missing = rules.filter(
      (rule) => !existingKeys.has(`${rule.ruleType}:${rule.ruleKey}`),
    );
    if (missing.length === 0) return 0;

    const result = await tx.salaryRule.createMany({
      data: missing.map((rule) => ({
        ...rule,
        effectiveFrom: now,
      })),
      skipDuplicates: true,
    });
    return result.count;
  });

  console.log(
    `  ✓ 薪资规则 ${rules.length} 条（新建 ${created}，保留已有 ${rules.length - created}）`,
  );
}

// ============================================================
// 3A. 新工序计件价簿占位（仅 DRAFT）
// ============================================================
async function seedPieceworkPriceBook() {
  const result = await seedPieceworkPriceBookV1Placeholder(db);
  console.log(
    `  ✓ 工序计件价簿 v1 ${result.status}` +
      `（新建价簿 ${result.createdBook ? 1 : 0}，补齐占位规则 ${result.createdRules}）`,
  );
}

// ============================================================
// 4. 推送事件预置
// ============================================================
async function seedNotificationEvents() {
  const rules = [
    {
      eventType: 'ORDER_SUBMITTED',
      messageTemplate: '**新工单提交**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    },
    {
      eventType: NOTIFICATION_EVENTS.ORDER_CHANGE_REQUESTED,
      messageTemplate: '**工单变更/取消申请**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    },
    {
      eventType: NOTIFICATION_EVENTS.PRODUCTION_PROGRESS_ANOMALY,
      messageTemplate: '⚠️ **报工进度异常**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    },
    {
      eventType: NOTIFICATION_EVENTS.PRODUCTION_STAGNANT,
      messageTemplate: '⏳ **生产停滞**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    },
    {
      eventType: NOTIFICATION_EVENTS.PENDING_FACTORY_BACKLOG,
      messageTemplate: '📋 **待确认积压**\n工单号：{orderNo}\n{summary}\n{deepLink}',
    },
    {
      eventType: 'URGENT_ORDER',
      messageTemplate: '🚨 **急单提醒**\n工单号：{orderNo}\n提交人：{submitterName}\n请立即安排！',
    },
    {
      eventType: 'ORDER_SCHEDULED',
      messageTemplate:
        '**工单已下发**\n工单号：{orderNo}\n当前生产步骤数：{taskCount}',
    },
    {
      eventType: 'ORDER_COMPLETED',
      messageTemplate:
        '**生产已完成**\n工单号：{orderNo}\n请在系统核对当前状态后处理',
    },
    {
      eventType: 'ORDER_SHIPPED',
      messageTemplate: '**工单已发货**\n工单号：{orderNo}\n快递单号：{trackingNo}',
    },
    {
      eventType: 'OUTSOURCE_OVERDUE',
      messageTemplate: '⚠️ **外协超期**\n外协单：{outsourceId}\n供应商：{supplierName}\n预计回货日：{expectedDate}',
    },
    {
      eventType: 'ORDER_OVERDUE',
      messageTemplate: '🚚 **交期逾期**\n工单：{orderNo}\n客户：{customerRef}\n承诺交期：{promisedDate}\n已逾期：{daysOverdue} 天\n当前状态：{status}',
    },
    {
      eventType: 'STOCK_ALERT',
      messageTemplate: '📦 **库存告警**\n物料：{materialName}\n当前库存：{currentStock}\n安全库存：{safetyStock}',
    },
    // &ldquo;业绩合计&rdquo;反映 Slice D wire 喂入的 salesForTier (= totalSales
    // + initialSales)，与提成档位口径一致（Codex round 113 medium）。
    // 之前写&ldquo;当前业绩&rdquo;会让 initialSales != 0 的客服看到&ldquo;业绩&rdquo;
    // 比命中档位低，管理员看不出 why。
    {
      eventType: 'CS_PERIOD_ENDING',
      messageTemplate: '📅 **客服周期即将结束**\n客服：{csName}\n业绩合计：¥{totalSales}\n还有{daysLeft}天结算',
    },
    {
      eventType: 'CS_PERIOD_SETTLED',
      messageTemplate: '💰 **客服周期结算**\n客服：{csName}\n周期业绩：¥{totalSales}\n提成：¥{commission}',
    },
    {
      eventType: 'DAILY_WORKER_SALARY',
      messageTemplate: '**今日师傅日薪结算完成**\n师傅数：{workerCount}\n总金额：¥{totalAmount}',
    },
  ];

  // NotificationRule is administrator-owned configuration after its first
  // creation. A deploy-time seed must never restore the default template,
  // activation switch or channel routing over an existing row. eventType is
  // the only registry identity and is unique, so createMany + ON CONFLICT DO
  // NOTHING safely fills newly introduced events without updating any
  // configurable field.
  const created = await db.notificationRule.createMany({
    data: rules.map((rule) => ({
      eventType: rule.eventType,
      channelIds: [], // 上线后管理员自己配置
      messageTemplate: rule.messageTemplate,
      isActive: false, // 默认关闭，配好 Webhook 再开启
    })),
    skipDuplicates: true,
  });
  console.log(
    `  ✓ 推送事件规则 ${rules.length} 条（新建 ${created.count}，保留已有 ${rules.length - created.count}）`,
  );
}

// ============================================================
// 5. 系统配置
// ============================================================
async function seedSettings() {
  // key / 默认值 / remark 都来自 lib/settings/definitions —— 那里同时是读取侧
  // 和后台设置页的唯一定义处。此前这份清单是手写的，和代码里的常量各写各的，
  // 结果 seed 的 '佛山红包印刷厂' 和打印组件默认的 '红包印刷厂' 长期对不上，
  // 而且谁都没发现，因为根本没有代码读这张表。
  //
  // 只 create、不 update：业主改过的值不能被下一次 seed 冲掉。这张表从来是
  // 配置而不是字典，覆盖写等于把人家的设置改回默认。
  let created = 0;
  for (const key of SETTING_KEYS) {
    const definition = SETTING_DEFINITIONS[key];
    const result = await db.setting.createMany({
      data: [{ key, value: definition.fallback, remark: definition.remark }],
      skipDuplicates: true,
    });
    created += result.count;
  }

  // 退役的 key：留着会让翻库的人以为还能配。见 definitions.ts 的
  // RETIRED_SETTING_KEYS 注释。
  const { count: removed } = await db.setting.deleteMany({
    where: { key: { in: [...RETIRED_SETTING_KEYS] } },
  });

  console.log(
    `  ✓ 系统配置 ${SETTING_KEYS.length} 项（新建 ${created}，保留已有 ${SETTING_KEYS.length - created}，清理退役 ${removed}）`,
  );
}

main()
  .catch((e) => {
    console.error('❌ 种子数据初始化失败：', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
