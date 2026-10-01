import { renderToStaticMarkup } from 'react-dom/server';
import { Input } from '@/components/ui/input';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionNotice,
  BatchActionResult,
  ConflictResolutionPanel,
  FormErrorSummary,
  FormMessage,
  TableEmptyState,
  TerminalReadOnlyBanner,
  formMessageA11yProps,
  formMessageId,
} from '@/components/ui-business';
import { focusFormErrorSummary } from '@/components/ui-business/FormErrorSummary';

describe('ActionNotice', () => {
  it.each(['success', 'info', 'primary', 'warning'] as const)(
    'announces %s feedback politely without destructive styling',
    (tone) => {
      const html = renderToStaticMarkup(
        <ActionNotice tone={tone} title="操作完成" description="结果说明" />,
      );

      expect(html).toContain('data-slot="action-notice"');
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).not.toContain('bg-destructive');
    },
  );

  it('primary tone（待工厂核价）用品牌色，不借 warning / destructive', () => {
    const html = renderToStaticMarkup(
      <ActionNotice tone="primary" title="待工厂核价" />,
    );
    expect(html).toContain('bg-primary/10');
    expect(html).toContain('border-primary/40');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('destructive');
  });

  it('reserves assertive destructive semantics for errors', () => {
    const html = renderToStaticMarkup(
      <ActionNotice tone="error" title="保存失败" />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('bg-destructive/10');
    expect(html).toMatch(/aria-labelledby="[^\"]+"/);
  });
});

describe('form feedback', () => {
  it('builds one stable message id for the control and message', () => {
    const fieldId = 'unit-price';
    const a11yProps = formMessageA11yProps(fieldId, 'error');
    const html = renderToStaticMarkup(
      <>
        <Input id={fieldId} {...a11yProps} />
        <FormMessage fieldId={fieldId} tone="error">
          单价必须大于或等于 0
        </FormMessage>
      </>,
    );

    expect(formMessageId(fieldId)).toBe('unit-price-message');
    expect(a11yProps).toEqual({
      'aria-describedby': 'unit-price-message',
      'aria-errormessage': 'unit-price-message',
      'aria-invalid': true,
    });
    expect(html).toContain('aria-describedby="unit-price-message"');
    expect(html).toContain('aria-errormessage="unit-price-message"');
    expect(html).toContain('id="unit-price-message"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-live="assertive"');
  });

  it('keeps non-error hints out of live regions', () => {
    const html = renderToStaticMarkup(
      <FormMessage fieldId="customer">请输入客户名称</FormMessage>,
    );

    expect(html).toContain('data-tone="hint"');
    expect(html).not.toContain('role=');
    expect(html).not.toContain('aria-live=');
  });

  it('indexes errors with direct links to their controls', () => {
    const html = renderToStaticMarkup(
      <FormErrorSummary
        errors={[
          { fieldId: 'unit-price', label: '单价', message: '不能小于 0' },
          { fieldId: 'customer', label: '客户', message: '不能为空' },
        ]}
      />,
    );

    expect(html).toContain('data-slot="form-error-summary"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-auto-focus="submit-error"');
    expect(html).toContain('href="#unit-price"');
    expect(html).toContain('href="#customer"');
  });

  it('does not render an empty error summary', () => {
    expect(renderToStaticMarkup(<FormErrorSummary errors={[]} />)).toBe('');
  });

  it('moves focus to the submitted error summary', () => {
    const focus = vi.fn();

    focusFormErrorSummary({ focus });

    expect(focus).toHaveBeenCalledOnce();
  });
});

describe('BatchActionResult', () => {
  it('distinguishes skipped, unknown and unattempted items without declaring them confirmed failures', () => {
    const html = renderToStaticMarkup(
      <BatchActionResult
        status="partial" succeededCount={0} failedCount={0}
        summary="跳过 1 张，结果未知 1 张，未执行 1 张"
        items={[
          { id: 'skip', label: '工单甲', outcome: 'skipped', reason: '先完成工厂确认' },
          { id: 'unknown', label: '工单乙', outcome: 'unknown', reason: '打开工单核对实际结果' },
          { id: 'pending', label: '工单丙', outcome: 'not-attempted', reason: '核对后重新选择' },
        ]}
      />,
    );
    expect(html).toContain('跳过 1 张，结果未知 1 张，未执行 1 张');
    expect(html).not.toContain('项失败');
    expect(html).not.toContain('text-destructive');
    expect(html).toContain('data-outcome="unknown"');
    expect(html).toContain('data-outcome="not-attempted"');
  });

  it('uses a polite success result when every item completes', () => {
    const html = renderToStaticMarkup(
      <BatchActionResult
        status="complete"
        succeededCount={3}
        failedCount={0}
      />,
    );

    expect(html).toContain('data-status="complete"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('3 项成功，0 项失败');
    expect(html).toContain('bg-success/10');
  });

  it('shows a warning partial result and every item reason', () => {
    const html = renderToStaticMarkup(
      <BatchActionResult
        status="partial"
        succeededCount={1}
        failedCount={1}
        items={[
          { id: 'ok', label: '工单 A', outcome: 'success' },
          {
            id: 'failed',
            label: '工单 B',
            outcome: 'failure',
            reason: '工单已结案',
          },
        ]}
      />,
    );

    expect(html).toContain('data-status="partial"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('bg-warning/10');
    expect(html).not.toContain('bg-destructive/10');
    expect(html).toContain('data-outcome="success"');
    expect(html).toContain('data-outcome="failure"');
    expect(html).toContain('工单已结案');
  });

  it('uses destructive styling when the entire batch fails', () => {
    const html = renderToStaticMarkup(
      <BatchActionResult
        status="failure"
        succeededCount={0}
        failedCount={2}
      />,
    );

    expect(html).toContain('data-status="failure"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('bg-destructive/10');
  });
});

describe('ConflictResolutionPanel', () => {
  it('keeps mine, latest and cancel decisions explicit', () => {
    const html = renderToStaticMarkup(
      <ConflictResolutionPanel
        mine={<span>数量 1200</span>}
        latest={<span>数量 1500</span>}
        keepMineAction={<button type="button">保留我的版本</button>}
        useLatestAction={<button type="button">使用最新版本</button>}
        cancelAction={<button type="button">取消</button>}
      />,
    );

    expect(html).toContain('data-slot="conflict-resolution-panel"');
    expect(html).toContain('data-slot="conflict-resolution-mine"');
    expect(html).toContain('data-slot="conflict-resolution-latest"');
    expect(html).toContain('data-slot="conflict-resolution-cancel"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('bg-warning/10');
    expect(html).not.toContain('bg-destructive');
    expect(html).toContain('系统不会自动覆盖');
  });
});

describe('TerminalReadOnlyBanner', () => {
  it('describes a terminal record as neutral read-only state', () => {
    const html = renderToStaticMarkup(<TerminalReadOnlyBanner />);

    expect(html).toContain('data-slot="terminal-read-only-banner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('bg-muted/40');
    expect(html).not.toContain('bg-warning');
    expect(html).not.toContain('bg-destructive');
  });
});

describe('TableEmptyState', () => {
  it('renders valid table row and cell structure', () => {
    const html = renderToStaticMarkup(
      <table>
        <tbody>
          <TableEmptyState colSpan={4} title="暂无工单" />
        </tbody>
      </table>,
    );

    expect(html).toContain('<tr data-slot="table-empty-state"');
    expect(html).toContain('data-variant="table"');
    expect(html).toContain('<td colSpan="4"');
    expect(html).toContain('role="status"');
  });

  it('renders a compact non-table shape for mobile lists', () => {
    const html = renderToStaticMarkup(
      <TableEmptyState
        variant="compact"
        title="筛选无结果"
        description="请清除筛选"
      />,
    );

    expect(html).toMatch(/^<div/);
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<tr');
  });
});
