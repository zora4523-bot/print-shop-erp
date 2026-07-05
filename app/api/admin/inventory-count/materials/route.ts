import { NextResponse, type NextRequest } from 'next/server';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requirePermission } from '@/lib/auth/permissions';
import { listInventoryCountMaterials } from '@/lib/inventory-count';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requirePermission('material:manage');
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
