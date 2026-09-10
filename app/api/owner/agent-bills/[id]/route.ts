import { auth } from '@/lib/auth/config';
import { handleAgentMonthlyBillDetailGet } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = auth(handleAgentMonthlyBillDetailGet);
