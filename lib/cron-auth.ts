import { NextResponse } from 'next/server';

// 7 个 /api/cron/* 路由共用的 Bearer 认证守卫（此前逐字重复 7 份）。
//
// 契约（与原样板逐字节一致，勿改响应形状——外部调度器可能解析）：
//   - CRON_SECRET 未配置 → 503（部署漏配时快速失败，防端点裸奔）
//   - Authorization 缺失或 ≠ `Bearer <secret>` → 401
//   - 通过 → 返回 null，路由继续执行业务
//
// 用法：
//   const denied = requireCronAuth(req);
//   if (denied) return denied;
export function requireCronAuth(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }

  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
