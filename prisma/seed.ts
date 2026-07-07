/**
 * 种子数据初始化
 *
 * 运行：pnpm prisma db seed
 *
 * 包含：
 * 1. 默认管理员账号
 * 2. 工艺字典（12种工艺）
 * 3. 薪资规则默认值（三套体系）
 * 4. 推送事件类型预置
 * 5. 系统配置
 *
 * 注意：Prisma 7 的 client 从 ./generated/prisma 导入，不是 @prisma/client
 */

import { randomBytes } from 'node:crypto';
import { PrismaClient, Role, MachineType } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

// Prisma 7 要求显式指定 adapter
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 开始种子数据初始化...');

  await seedAdmin();
  await seedCrafts();
  await seedSalaryRules();
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
    // Non-OWNER collision: refuse — silently promoting a WORKER/SALES/etc to
    // OWNER is the privilege-leak Codex round 2 called out.
    if (existing.role !== Role.OWNER) {
      throw new Error(
        `SEED_ADMIN_USERNAME "${username}" 已被非 OWNER 账号占用（role=${existing.role}）；` +
          '拒绝将已有账号静默提权为 OWNER。请换用其它 SEED_ADMIN_USERNAME。',
      );
    }

    // Row is an OWNER. Separate "reset password" (never privilege-altering)
    // from "reactivate a dormant OWNER" (privilege-altering when another
    // OWNER is already active, per Codex round 5).
    if (fromEnv) {
      const hashed = await bcrypt.hash(fromEnv, 10);

      if (existing.isActive) {
        // Pure password reset — the row is already the (or an) active OWNER.
        await db.user.update({
          where: { id: existing.id },
          data: { password: hashed },
        });
        console.log(`  🔑 已重置活跃 OWNER ${username} 的密码（来自 SEED_ADMIN_PASSWORD）`);
        return;
      }

      // Dormant OWNER: reactivation would add a second active OWNER if any
      // other OWNER is already active under a different username.
      const otherActiveOwners = await db.user.count({
        where: { role: Role.OWNER, isActive: true },
      });
      if (otherActiveOwners > 0) {
        throw new Error(
          `既有 ${otherActiveOwners} 位活跃 OWNER，拒绝同时将非活跃 OWNER "${username}" 重新激活` +
            '（会产生多个同时活跃的超级用户）。请先 deactivate 当前活跃 OWNER 再重跑 seed，' +
            '或换用其它 SEED_ADMIN_USERNAME 以定向重置活跃 OWNER。',
        );
      }

      await db.user.update({
        where: { id: existing.id },
        data: { password: hashed, isActive: true },
      });
      console.log(`  🔑 已重置 OWNER ${username} 的密码并重新激活（来自 SEED_ADMIN_PASSWORD）`);
      return;
    }

    if (existing.isActive) {
      console.log(`  ⏭  已有活跃 OWNER ${username}，跳过管理员种子`);
    } else {
      throw new Error(
        `用户 "${username}" 已存在且 role=OWNER（isActive=false）。` +
          '可选恢复路径：(1) DBA 直接 UPDATE isActive=true；' +
          '(2) 设置 SEED_ADMIN_PASSWORD 后重跑 seed，将自动重置密码并激活。',
      );
    }
    return;
  }

  // ── Branch 2: the target username does not exist ────────────────────────
  // Don't create a second superuser behind the back of an existing active OWNER
  // (e.g. the operator renamed the original admin but left the default
  // SEED_ADMIN_USERNAME in env — the fresh "admin" would silently become a
  // second OWNER).
  const activeOwnerCount = await db.user.count({
    where: { role: Role.OWNER, isActive: true },
  });
  if (activeOwnerCount > 0) {
    console.log(
      `  ⏭  已有 ${activeOwnerCount} 位活跃 OWNER（与 SEED_ADMIN_USERNAME=${username} 不同名），跳过`,
    );
    return;
  }

  // First seed into an empty DB, or recovery after all OWNERs were removed.
  const generated = fromEnv ? null : randomBytes(12).toString('base64url');
  const plaintext = fromEnv ?? generated!;
  const hashed = await bcrypt.hash(plaintext, 10);

  await db.user.create({
    data: {
      username,
      password: hashed,
      role: Role.OWNER,
      displayName: '老板',
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
    { name: '现货加烫', code: 'STOCK_FOIL', isOutsource: false, defaultMachineType: MachineType.HAND_PRESS, sortOrder: 10 },
    { name: '专版单色平烫', code: 'FLAT_FOIL_SINGLE', isOutsource: false, defaultMachineType: MachineType.WINDMILL, sortOrder: 20 },
    { name: '专版双色平烫', code: 'FLAT_FOIL_DOUBLE', isOutsource: false, defaultMachineType: MachineType.WINDMILL, sortOrder: 21 },
    { name: '浮雕', code: 'EMBOSS', isOutsource: false, defaultMachineType: MachineType.WINDMILL, sortOrder: 30 },
    { name: '激凸', code: 'BUMP', isOutsource: false, defaultMachineType: MachineType.WINDMILL, sortOrder: 31 },
    { name: '粘封', code: 'GLUING', isOutsource: false, defaultMachineType: MachineType.GLUE, sortOrder: 40 },
    { name: '打包/入袋', code: 'PACKING', isOutsource: false, defaultMachineType: null, sortOrder: 50 },
    { name: '清废', code: 'CLEANING', isOutsource: false, defaultMachineType: null, sortOrder: 51 },

    // 外协工艺
    { name: 'UV', code: 'UV', isOutsource: true, defaultMachineType: null, sortOrder: 60 },
    { name: '啤（模切）', code: 'DIE_CUT', isOutsource: true, defaultMachineType: null, sortOrder: 61 },
    { name: '冰白彩印（纯印刷）', code: 'COLOR_PRINT', isOutsource: true, defaultMachineType: null, sortOrder: 70 },
    { name: '冰白彩印（印刷+烫金）', code: 'COLOR_PRINT_FOIL', isOutsource: true, defaultMachineType: MachineType.WINDMILL, sortOrder: 71 },
  ];

  for (const craft of crafts) {
    await db.craft.upsert({
      where: { code: craft.code },
      update: craft,
      create: craft,
    });
  }
  console.log(`  ✓ 工艺字典 ${crafts.length} 条`);
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
        multiplierFactors: ['DOUBLE_COLOR'],
      },
      remark: '风车机师傅计件规则（无装板费，只按双色乘倍）',
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

  // 幂等策略 + 旧污染库修复：
  // 每条 (ruleType, ruleKey) 应当至多对应 1 行 effectiveTo=null 的"有效规则"。
  // 先前版本以 effectiveFrom=now 作 upsert 键，同一键会随每次 seed 累积多份 active 行，
  // 仅 findFirst+update 只能修好"新库"，老库里遗留的多份 active 仍违反不变量。
  //
  // 这里改为 findMany 拿出所有 active 行：
  //   - 0 行：按 effectiveFrom=now 新建；
  //   - ≥1 行：取最早创建的一行更新 value/remark；其余多余的 active 行收尾为
  //     effectiveTo=now，把它们降级为"历史规则"，让不变量恢复到 1 条 active。
  let collapsed = 0;
  for (const rule of rules) {
    const active = await db.salaryRule.findMany({
      where: {
        ruleType: rule.ruleType,
        ruleKey: rule.ruleKey,
        effectiveTo: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (active.length === 0) {
      await db.salaryRule.create({
        data: {
          ruleType: rule.ruleType,
          ruleKey: rule.ruleKey,
          ruleValue: rule.ruleValue,
          effectiveFrom: now,
          remark: rule.remark,
        },
      });
      continue;
    }

    const [keep, ...extras] = active;
    await db.salaryRule.update({
      where: { id: keep.id },
      data: { ruleValue: rule.ruleValue, remark: rule.remark },
    });

    if (extras.length > 0) {
      await db.salaryRule.updateMany({
        where: { id: { in: extras.map((r) => r.id) } },
        data: { effectiveTo: now },
      });
      collapsed += extras.length;
    }
  }

  if (collapsed > 0) {
    console.log(`  ⚠  发现 ${collapsed} 条重复的 active 薪资规则，已收尾为历史记录（effectiveTo=now）`);
  }
  console.log(`  ✓ 薪资规则 ${rules.length} 条`);
}

// ============================================================
// 4. 推送事件预置
// ============================================================
async function seedNotificationEvents() {
  const rules = [
    {
      eventType: 'ORDER_SUBMITTED',
      messageTemplate: '**新工单提交**\n工单号：{orderNo}\n提交人：{submitterName}\n金额：¥{totalAmount}\n{urgentMark}',
    },
    {
      eventType: 'URGENT_ORDER',
      messageTemplate: '🚨 **急单提醒**\n工单号：{orderNo}\n提交人：{submitterName}\n请立即安排！',
    },
    {
      eventType: 'ORDER_SCHEDULED',
      messageTemplate: '**工单已排产**\n工单号：{orderNo}\n分配任务数：{taskCount}',
    },
    {
      eventType: 'ORDER_COMPLETED',
      messageTemplate: '**工单完工**\n工单号：{orderNo}\n可以安排发货',
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
    // 比命中档位低，老板看不出 why。
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

  for (const rule of rules) {
    await db.notificationRule.upsert({
      where: { eventType: rule.eventType },
      update: {
        messageTemplate: rule.messageTemplate,
      },
      create: {
        eventType: rule.eventType,
        channelIds: [], // 上线后老板自己配置
        messageTemplate: rule.messageTemplate,
        isActive: false, // 默认关闭，配好Webhook再开启
      },
    });
  }
  console.log(`  ✓ 推送事件规则 ${rules.length} 条（默认未启用，配好Webhook后启用）`);
}

// ============================================================
// 5. 系统配置
// ============================================================
async function seedSettings() {
  const settings = [
    { key: 'factory_name', value: { name: '佛山红包印刷厂' }, remark: '工厂名称（可改）' },
    { key: 'order_no_prefix', value: { format: 'YYYYMMDD-XXXX' }, remark: '工单号格式' },
    { key: 'cdr_link_expire_hours', value: { hours: 24 }, remark: 'CDR下载链接有效期' },
    { key: 'outsource_overdue_days', value: { days: 1 }, remark: '外协超期阈值（超过预计日N天报警）' },
  ];

  for (const s of settings) {
    await db.setting.upsert({
      where: { key: s.key },
      update: { value: s.value, remark: s.remark },
      create: { key: s.key, value: s.value, remark: s.remark },
    });
  }
  console.log(`  ✓ 系统配置 ${settings.length} 条`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据初始化失败：', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
