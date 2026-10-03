import { auth } from '@/lib/auth/config';
import { handleAnalyticsExport } from './handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = auth(request => handleAnalyticsExport(request));
