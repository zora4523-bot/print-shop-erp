import { auth } from '@/lib/auth/config';
import { handleAgentMonthlyBillExportDownload } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = auth(handleAgentMonthlyBillExportDownload);
