import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_MODULES } from '@/lib/navigation/admin-modules';

function source(...segments: string[]): string {
  return readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

describe('agent monthly bill owner cutover', () => {
  it('routes the existing bill navigation slot to the v2 ledger', () => {
    const entry = ADMIN_MODULES.find((item) => item.id === 'owner.bills');
    expect(entry).toMatchObject({
      label: '账单',
      routeBase: '/owner/agent-bills',
      requiredPermission: 'bill:view:all',
    });
  });

  it('keeps the explicit legacy archive pages read-only', () => {
    const list = source(
      'app',
      '(billing)',
      'owner',
      'bills',
      'archive',
      'page.tsx',
    );
    const detail = source(
      'app',
      '(billing)',
      'owner',
      'bills',
      'archive',
      '[id]',
      'page.tsx',
    );
    for (const file of [list, detail]) {
      expect(file).not.toContain("from '@/actions/");
      expect(file).not.toContain('GenerateBillsForm');
      expect(file).not.toContain('IssueBillButton');
      expect(file).not.toContain('RecordPaymentForm');
    }
  });

  it('turns the former legacy writer routes into compatibility redirects', () => {
    const list = source('app', '(billing)', 'owner', 'bills', 'page.tsx');
    const detail = source(
      'app',
      '(billing)',
      'owner',
      'bills',
      '[id]',
      'page.tsx',
    );
    expect(list).toContain("redirect('/owner/agent-bills')");
    expect(detail).toContain(
      'redirect(`/owner/bills/archive/${encodeURIComponent(id)}`)',
    );
  });

  it('does not render an editable payment amount in v2', () => {
    const forms = source(
      'components',
      'business',
      'agent-monthly-billing',
      'AgentMonthlyBillForms.tsx',
    );
    const paidForm = forms.slice(
      forms.indexOf('export function MarkAgentMonthlyBillPaidForm'),
      forms.indexOf('export function CreateAgentMonthlyBillCreditForm'),
    );
    expect(paidForm).not.toContain('name="amount"');
    expect(paidForm).toContain('{formatMoney(lockedAmount)}');
    expect(paidForm).not.toContain('服务端');
  });

  it('uses the independent durable export action, status API, and download route', () => {
    const page = source(
      'app',
      '(billing)',
      'owner',
      'agent-bills',
      'page.tsx',
    );
    const controls = source(
      'components',
      'business',
      'agent-monthly-billing',
      'AgentMonthlyBillExportControls.tsx',
    );
    const action = source('actions', 'agent-monthly-bill-export.ts');
    expect(page).toContain('listRecentAgentMonthlyBillExports(actor.id)');
    expect(page).toContain('<AgentMonthlyBillExportControls');
    expect(controls).toContain('requestAgentMonthlyBillExportAction');
    expect(controls).toContain(
      '/api/owner/agent-bills/exports/${encodeURIComponent(id)}/status',
    );
    expect(controls).toContain(
      'href={`/api/owner/agent-bills/exports/${item.id}`}',
    );
    expect(action).toContain("requirePermission('bill:manage')");
    expect(action).toContain("backgroundJobsMode() === 'durable'");
    expect(action).not.toContain("from '@/lib/order/export'");
  });
});
