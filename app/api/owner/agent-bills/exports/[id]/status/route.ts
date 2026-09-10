import { auth } from '@/lib/auth/config';
import { handleAgentMonthlyBillExportStatus } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = auth(handleAgentMonthlyBillExportStatus);
