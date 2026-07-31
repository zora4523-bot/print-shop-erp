import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
import { auth } from '@/lib/auth/config';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { listInventoryCountMaterials } from '@/lib/inventory-count';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const materials = await listInventoryCountMaterials({ q, limit });
  return NextResponse.json({ materials });
}

export const GET = auth(handleInventoryCountMaterialsGet);
