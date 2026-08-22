import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

// 8 个 /api/cron/* 路由共用的 Bearer 认证守卫。
//
// 契约（与原样板逐字节一致，勿改响应形状——外部调度器可能解析）：
//   - CRON_SECRET 未配置 → 503 { error: 'CRON_SECRET not configured' }
//     （部署漏配时快速失败，防端点裸奔）
//   - Authorization 缺失或 ≠ `Bearer <secret>` → 401 { error: 'Unauthorized' }
//   - 通过 → 返回 null，路由继续执行业务
// 状态码与 body 字段名逐字节都是对外契约，改动前先看 DECISIONS 2026-04-24。
//
// 用法：
//   const denied = requireCronAuth(req);
//   if (denied) return denied;

// 进程内一次性随机密钥：比较前先把两侧 HMAC 成定长 32 字节摘要。
// 这一步同时解决两个坑：
//   1. timingSafeEqual 要求两个 Buffer 等长，长度不等直接抛 RangeError。
//      摘要恒为 32 字节，于是不需要「长度不同就早返回」——那种写法会把
//      密钥长度重新变成一条旁路。
//   2. 摘要用随机密钥生成、攻击者不可预测，即便比较过程仍有残余时序差，
//      也推不出明文密钥。
const COMPARE_KEY = randomBytes(32);

function digest(value: string) {
  return createHmac('sha256', COMPARE_KEY).update(value, 'utf8').digest();
}

/** 恒定时间比较：不因长度差异提前返回，分支也不依赖内容匹配了多少字节。 */
function safeEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

export function requireCronAuth(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }

  // 头缺失时按空串比较，和「值不匹配」共用同一条路径（同样两次 HMAC），
  // 不额外给出「头存在与否」的时序信号。
  const auth = req.headers.get('authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${expected}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
