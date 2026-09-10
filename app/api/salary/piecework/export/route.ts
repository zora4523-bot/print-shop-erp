import { auth } from '@/lib/auth/config';
import { handlePieceworkExportGet } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = auth(handlePieceworkExportGet);
