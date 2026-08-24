import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ReportTaskMutationResult } from '@/actions/production.types';

// 「超报确认」在 hydration 后会随输入即时出现；零 JS 时仍由提交后的服务端
// state 驱动。tests/visual 的页面加载态走不到后者，这里注入 state 把降级路径钉住。
//
// 钉的是三件事，都是回归过就会静默出事的：
//   1. 复选框保留**服务端状态**驱动的原生 input[type=checkbox] 降级路径；
//      即时 onInput 只是增强，零 JS 提交后仍能勾选再提交。
//   2. 三个数量框回填服务端传回的字符串。回退成 defaultValue={plannedQty}
//      会让「超报被拦 → 数字重置回计划数 → 勾确认后按计划数入库」，正好把
//      守卫要防的事做实。
//   3. 数量框**不设 max**。原生约束校验关掉 JS 也生效，手机上只弹一个原生
//      气泡、极易滚出视野，写清楚上限数字的中文提示就永远看不到。
const { actionState } = vi.hoisted(() => ({
  actionState: { current: null as ReportTaskMutationResult | null },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/actions/production', () => ({
  reportTaskAction: Object.assign(vi.fn(), { bind: () => vi.fn() }),
}));

import { ReportTaskForm } from '../ReportTaskForm';

const source = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'production',
    'ReportTaskForm.tsx',
  ),
  'utf8',
);

function render() {
  return renderToStaticMarkup(
    <ReportTaskForm
      taskId="task-1"
      plannedQty={5000}
      maxReportQty={15000}
      isPiecework
    />,
  );
}

describe('ReportTaskForm 超报确认', () => {
  it('首次渲染没有确认框——不打扰正常报工', () => {
    actionState.current = null;
    const html = render();
    expect(html).not.toContain('name="overReportConfirmed"');
    // 默认值仍然是计划数
    expect(html).toMatch(/name="completedQty"[^>]*value="5000"/);
  });

  it('hydration 后输入一超计划就显示确认区，不必先提交失败一次', () => {
    expect(source).toContain('setLiveTotal(');
    expect(source).toMatch(
      /const showOverReportConfirm =[\s\S]{0,100}liveOverPlan \|\|/,
    );
    expect(source).toContain('当前合计 ${liveTotal.toLocaleString()}');
  });

  it('报工主按钮以 52px 吸底并保留 safe-area', () => {
    expect(source).toContain('sticky bottom-0');
    expect(source).toContain('env(safe-area-inset-bottom)');
    expect(source).toContain('min-h-[52px]');
  });

  it('服务端说需要确认时渲染原生 checkbox（零 JS 也能勾能提交）', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        overReportConfirmed: [
          '合计报工 6200 超过计划数 5000，请勾选「确认超出计划数」后再提交。',
        ],
      },
      values: {
        completedQty: '6200',
        defectQty: '0',
        reworkQty: '0',
        overReportConfirmed: false,
      },
      overReport: { plannedQty: 5000, totalReported: 6200 },
    };
    const html = render();
    expect(html).toMatch(
      /<input[^>]*id="overReportConfirmed"[^>]*type="checkbox"/,
    );
    expect(html).toContain('name="overReportConfirmed"');
  });

  it('确认框的 aria-describedby 指向真实存在的元素，且承载错误文案', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        overReportConfirmed: ['请勾选「确认超出计划数」后再提交。'],
      },
      values: {
        completedQty: '6200',
        defectQty: '0',
        reworkQty: '0',
        overReportConfirmed: false,
      },
      overReport: { plannedQty: 5000, totalReported: 6200 },
    };
    const html = render();
    const m = html.match(
      /id="overReportConfirmed"[^>]*aria-describedby="([^"]+)"/,
    );
    expect(m, '确认框应带 aria-describedby').not.toBeNull();
    for (const id of m![1]!.split(' ')) {
      expect(html, `aria-describedby 引用了不存在的 id: ${id}`).toContain(
        `id="${id}"`,
      );
    }
    expect(html).toContain('请勾选「确认超出计划数」后再提交。');
  });

  it('回填服务端传回的数量，而不是重置回计划数', () => {
    actionState.current = {
      status: 'invalid',
      fieldErrors: {
        overReportConfirmed: ['请勾选「确认超出计划数」后再提交。'],
      },
      values: {
        completedQty: '6200',
        defectQty: '30',
        reworkQty: '0',
        overReportConfirmed: false,
      },
      overReport: { plannedQty: 5000, totalReported: 6230 },
    };
    const html = render();
    expect(html).toMatch(/name="completedQty"[^>]*value="6200"/);
    expect(html).toMatch(/name="defectQty"[^>]*value="30"/);
    expect(html).not.toMatch(/name="completedQty"[^>]*value="5000"/);
  });

  it('硬拒（已达倍数上限）走 role="alert"、不渲染确认框，但仍回填数量', () => {
    actionState.current = {
      status: 'error',
      message:
        '合计报工 50000 已达到计划数 5000 的 3 倍上限（15000），请核对数量后重新填写。',
      values: {
        completedQty: '50000',
        defectQty: '0',
        reworkQty: '0',
        overReportConfirmed: false,
      },
    };
    const html = render();
    expect(html).not.toContain('name="overReportConfirmed"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('3 倍上限（15000）');
    expect(html).toMatch(/name="completedQty"[^>]*value="50000"/);
  });

  it('数量框不设 max —— 上限判定只在服务端，才能给出可读中文提示', () => {
    // 合计上限（计划数 × 倍数）只有服务端算得出；把它写成单字段 max 会让
    // 浏览器抢先弹一个原生气泡，那句「已达到计划数 N 倍上限（具体数字）」
    // 的提示就永远不会被师傅看到。上限信息只出现在说明文字里。
    actionState.current = null;
    const html = render();
    expect(html).not.toMatch(/name="completedQty"[^>]*max=/);
    expect(html).not.toMatch(/name="defectQty"[^>]*max=/);
    expect(html).not.toMatch(/name="reworkQty"[^>]*max=/);
    expect(html).toContain('15,000');
  });
});
