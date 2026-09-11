import { getVerifiedSession } from '@/lib/auth/session';
import { auth } from '@/lib/auth/config';
import type { NextAuthRequest } from 'next-auth';
import { getOrderScopeFilter } from '@/lib/auth/order-scope';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGet(request: NextAuthRequest, context: { params: Promise<{ id: string; shipmentId: string; labelId: string }> }) {
  const session = await getVerifiedSession(request.auth);
  if (!session) return new Response(null, { status: 401 });
  const { id, shipmentId, labelId } = await context.params;
  const label = await db.orderShipmentLabel.findFirst({ where: {
    id: labelId, shipmentId, shipment: { orderId: id, order: getOrderScopeFilter(session.user) },
  }, select: { image: true } });
  if (!label) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(label.image), { headers: {
    'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline; filename="waybill.jpg"',
  } });
}

export const GET = auth(handleGet);
