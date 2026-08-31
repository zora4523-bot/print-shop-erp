import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { auth } from '@/lib/auth/config';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { listInventoryCountMaterials } from '@/lib/inventory-count';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVENTORY_COUNT_MATERIALS_LIMIT_ERROR =
  'limit 必须是 1 到 100 之间的整数';

function parseLimit(searchParams: URLSearchParams): number | undefined | null {
  const values = searchParams.getAll('limit');
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;

  const parsed = Number(values[0]);
  if (!Number.isSafeInteger(parsed) || parsed > 100) return null;
  return parsed;
}

export async function handleInventoryCountMaterialsGet(
  request: NextAuthRequest,
) {
  try {
    await requireSessionPermission('material:manage', request.auth);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const q = request.nextUrl.searchParams.get('q') ?? '';
  const limit = parseLimit(request.nextUrl.searchParams);
  if (limit === null) {
    return NextResponse.json(
      { error: INVENTORY_COUNT_MATERIALS_LIMIT_ERROR },
      { status: 400 },
    );
  }
  const materials = await listInventoryCountMaterials({ q, limit });
  return NextResponse.json({ materials });
}

export const GET = auth(handleInventoryCountMaterialsGet);
