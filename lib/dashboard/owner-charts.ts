import Decimal from 'decimal.js';
import { Role } from '../../generated/prisma/enums';
import { db } from '../db';
import { currentShanghaiMonth, todayShanghai } from './shanghai-clock';

// Owner dashboard chart data — pure server lib, no Prisma client types
// crossing the wire. All money returned as decimal-string ("0.00") so
// `'use client'` chart components can render without re-hydrating Decimal.
//
// 3 datasets:
//   - getProductionTrend(now)       近 30 天每日完工 / 发货 / 完结
//   - getSalesRanking(now)          本月销售 / 客服业绩 Top 10（按提交时间）
//   - getCategoryDistribution(now)  本月各产品线工单数（按提交时间）
//
// 业绩归属时间口径走 DECISIONS 2026-04-26：销售排行 / 产品分布按
// `Order.submittedAt`。"产量曲线"按 `Order.completedAt`（生产视角，
// 不是业绩视角，问的是&ldquo;那天产线干了多少&rdquo;）。

const TREND_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────
// 30 天产量曲线
// ─────────────────────────────────────────────────────────────────────

export type ProductionTrendPoint = {
  // YYYY-MM-DD（Asia/Shanghai 日历日）
  day: string;
  count: number;
};

/**
 * 近 30 天每日完工工单数。raw SQL 走 `AT TIME ZONE 'Asia/Shanghai'`
 * 把 UTC 时间戳挪到 Shanghai 日历日，再 group by date。Prisma 的
 * groupBy 不支持 date_trunc / 时区转换，必须 raw。
 *
 * JS 侧补齐空白日：返回数组**总有 30 个元素**，按日期升序，缺测的
 * 日子 count = 0。recharts 的 LineChart 可以画出真实的低谷而不是
 * 跳过空白点。
 */
export async function getProductionTrend(
  now: Date = new Date(),
): Promise<ProductionTrendPoint[]> {
  const today = todayShanghai(now);
  // 30 天窗口：endExclusive = (Shanghai 今日 + 1 天) 0:00；start = end - 30 天。
  // 用 UTC 16:00 of (Shanghai today − 1) 作为 todayStart，向前推 30 天 / 向后
  // 推 1 天。
  const todayStart = shanghaiDateToUtcInstant(today);
  const startExclusive = new Date(
    todayStart.getTime() - (TREND_DAYS - 1) * MS_PER_DAY,
  );
  const endExclusive = new Date(todayStart.getTime() + MS_PER_DAY);

  const rows = await db.$queryRaw<Array<{ day: string; count: bigint }>>`
    SELECT
      to_char(("completedAt" AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS day,
      count(*) AS count
    FROM "Order"
    WHERE "completedAt" >= ${startExclusive}
      AND "completedAt" < ${endExclusive}
      AND status IN ('COMPLETED', 'SHIPPED', 'FINISHED')
    GROUP BY day
    ORDER BY day ASC
  `;

  const byDay = new Map(rows.map((r) => [r.day, Number(r.count)]));
  const out: ProductionTrendPoint[] = [];
  for (let i = 0; i < TREND_DAYS; i++) {
    const dateUtc = new Date(
      startExclusive.getTime() + i * MS_PER_DAY + 8 * 60 * 60 * 1000,
    );
    // dateUtc points at noon-ish of Shanghai day i; format back to
    // YYYY-MM-DD via the shared helper to avoid timezone drift.
    const day = todayShanghai(dateUtc);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 本月销售排行 Top 10
// ─────────────────────────────────────────────────────────────────────

export type SalesRankingRow = {
  userId: string;
  displayName: string;
  role: Role; // SALES / CUSTOMER_SERVICE 才会现身（按角色着色）
  totalAmount: string; // ¥
  orderCount: number;
};

/**
 * 本月（Asia/Shanghai 日历月）按 `Order.submittedAt` 归属的销售
 * 排行，Top 10。两步查询：先 groupBy submitter 求 sum + count，按
 * sum desc 截 10；再 findMany 拉用户姓名 / 角色拼回。
 *
 * 业绩口径见 DECISIONS 2026-04-26：本表用 submittedAt（夯实即时反馈）；
 * 不与 SalaryPeriod.totalSales（按 mark-paid 累加）混用。
 */
export async function getSalesRanking(
  now: Date = new Date(),
): Promise<SalesRankingRow[]> {
  const month = currentShanghaiMonth(now);
  const [yyyy, mm] = month.split('-').map(Number);
  const monthStart = shanghaiYmdToUtcInstant(`${yyyy}-${pad2(mm!)}-01`);
  const monthEnd = shanghaiYmdToUtcInstant(
    `${mm === 12 ? yyyy! + 1 : yyyy}-${pad2(mm === 12 ? 1 : mm! + 1)}-01`,
  );

  const grouped = await db.order.groupBy({
    by: ['submitterId'],
    where: {
      submittedAt: { gte: monthStart, lt: monthEnd },
      status: { not: 'CANCELLED' },
      // 仅取&ldquo;真有业绩&rdquo;的 submitter（totalAmount > 0）。$0 工单虽然有效
      // （工艺免费试做 / 退单冲账等场景），但放进&ldquo;销售排行&rdquo;里只会
      // 噪音，让&ldquo;Top 10&rdquo;失去信号。同时也兜住 dev DB 脏数据 / E2E
      // fixture 的 0 元 SUBMITTED 工单不污染排行视觉。
      totalAmount: { gt: 0 },
    },
    _sum: { totalAmount: true },
    _count: { _all: true },
    orderBy: { _sum: { totalAmount: 'desc' } },
    take: 10,
  });

  const userIds = grouped.map((g) => g.submitterId);
  if (userIds.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, displayName: true, role: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return grouped.flatMap((g) => {
    const u = byId.get(g.submitterId);
    if (!u) return [];
    const sum = g._sum.totalAmount;
    // groupBy 后 sum 极少为 0（已经在 where 里过滤），但 _sum 可能在
    // 极端 NULL 行下回 null —— 兜底排掉，避免一行 ¥0.00 上榜。
    const sumDec = new Decimal((sum ?? 0) as unknown as Decimal.Value);
    if (sumDec.lte(0)) return [];
    return [
      {
        userId: u.id,
        displayName: u.displayName,
        role: u.role,
        totalAmount: sumDec.toFixed(2),
        orderCount: g._count._all,
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────
// 本月产品线分布
// ─────────────────────────────────────────────────────────────────────

export type CategoryDistributionRow = {
  // ProductCategory enum value 或 'UNCATEGORIZED'（OrderItem.productId
  // 为空时归这桶）
  category: string;
  orderCount: number;
};

/**
 * 本月按 `Order.submittedAt` 归属的工单 × 产品类目分布。
 *
 * 关键约束：count distinct orderId，避免一张工单多款式被重复计数。
 * OrderItem.productId 可空，null 进 UNCATEGORIZED 桶。
 */
export async function getCategoryDistribution(
  now: Date = new Date(),
): Promise<CategoryDistributionRow[]> {
  const month = currentShanghaiMonth(now);
  const [yyyy, mm] = month.split('-').map(Number);
  const monthStart = shanghaiYmdToUtcInstant(`${yyyy}-${pad2(mm!)}-01`);
  const monthEnd = shanghaiYmdToUtcInstant(
    `${mm === 12 ? yyyy! + 1 : yyyy}-${pad2(mm === 12 ? 1 : mm! + 1)}-01`,
  );

  const rows = await db.$queryRaw<
    Array<{ category: string; order_count: bigint }>
  >`
    SELECT
      COALESCE(p.category::text, 'UNCATEGORIZED') AS category,
      count(distinct oi."orderId") AS order_count
    FROM "OrderItem" oi
    LEFT JOIN "Product" p ON p.id = oi."productId"
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."submittedAt" >= ${monthStart}
      AND o."submittedAt" < ${monthEnd}
      AND o.status != 'CANCELLED'
    GROUP BY category
    ORDER BY order_count DESC
  `;

  return rows.map((r) => ({
    category: r.category,
    orderCount: Number(r.order_count),
  }));
}

// ─── helpers ───

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 复用 lib/dashboard/shanghai-clock 的语义但不引入 schemas（chart 模块
// 的 lib 链尽量薄，让 raw SQL 之外没有别的依赖）。
function shanghaiDateToUtcInstant(ymd: string): Date {
  return shanghaiYmdToUtcInstant(ymd);
}

function shanghaiYmdToUtcInstant(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  // UTC 16:00 of (D − 1) = Shanghai 00:00 of D
  return new Date(Date.UTC(y!, m! - 1, d! - 1, 16, 0, 0));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
