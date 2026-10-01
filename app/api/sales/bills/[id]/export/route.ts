import { auth } from '@/lib/auth/config';
import { handleSalesBillExport } from '../../export/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = auth(async (request, context: { params: Promise<{ id: string }> }) => handleSalesBillExport(request, (await context.params).id));
