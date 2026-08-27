import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  TaskStatus,
  WorkerType,
} from '@/generated/prisma/enums';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/production', () => ({
  beginTasksAction: vi.fn(),
  reportTasksAction: vi.fn(),
}));

import {
  WorkerTaskBatchList,
  batchCompletionImpactItems,
  validateBatchCompletionPreview,
} from '../WorkerTaskBatchList';

function task(
  id: string,
  status: TaskStatus,
  name: string,
  isUrgent = false,
  promisedDate: Date | null = new Date('2026-08-27T04:00:00.000Z'),
) {
  return {
    id,
    status,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    plannedQty: 5000,
    item: {
      name,
      sequence: 1,
      isDoubleSided: false,
      isDoubleColor: false,
    },
    craft: { name: '模切' },
    order: {
      orderNo: `PS-${id}`,
      customName: null,
      isUrgent,
      promisedDate,
      submitterName: '销售 A',
    },
  };
}

describe('WorkerTaskBatchList groups', () => {
  it('renders in-progress before pending with independent counts', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[
          task('pending-1', TaskStatus.PENDING, '待开款式'),
          task('progress-1', TaskStatus.IN_PROGRESS, '在制款式'),
          task('progress-2', TaskStatus.IN_PROGRESS, '在制款式二'),
        ]}
      />,
    );

    const progressHeading = html.indexOf(
      'id="worker-task-group-IN_PROGRESS"',
    );
    const pendingHeading = html.indexOf('id="worker-task-group-PENDING"');
    expect(progressHeading).toBeGreaterThan(-1);
    expect(pendingHeading).toBeGreaterThan(progressHeading);
    expect(html).toContain('在制款式');
    expect(html).toContain('待开款式');
    expect(html).toMatch(/进行中<\/h2>[\s\S]*?>2<\/span>/);
    expect(html).toMatch(/待开始<\/h2>[\s\S]*?>1<\/span>/);
    expect(html).toMatch(
      /data-tone="info"[^>]*>[\s\S]*?进行中<\/span>/,
    );
    expect(html).toMatch(
      /data-tone="neutral"[^>]*>[\s\S]*?待开始<\/span>/,
    );
  });

  it('keeps an explicit empty group so the two-state queue stays legible', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[task('pending-1', TaskStatus.PENDING, '待开款式')]}
      />,
    );

    expect(html).toContain('暂无进行中任务');
  });

  it('renders urgency as warning rather than destructive red', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[task('urgent-1', TaskStatus.IN_PROGRESS, '急单款式', true)]}
      />,
    );

    expect(html).toMatch(/data-tone="warning"[^>]*>急单<\/span>/);
    expect(html).not.toMatch(/bg-destructive[^>]*>急单/);
  });

  it('任务名称与无障碍标签不显示导入坐标', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[
          task(
            'source-marker-1',
            TaskStatus.IN_PROGRESS,
            '现货大号（产品表!C2）',
          ),
        ]}
      />,
    );

    expect(html).toContain('现货大号');
    expect(html).not.toContain('产品表!C2');
    expect(html).toContain('aria-label="选择 PS-source-marker-1 现货大号"');
  });

  it('未知机型不回显内部标识', () => {
    const unknownMachineTask = {
      ...task('unknown-machine', TaskStatus.IN_PROGRESS, '异常机型任务'),
      machineType: 'RAW_MACHINE' as MachineType,
    };
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[unknownMachineTask]}
      />,
    );
    const impacts = batchCompletionImpactItems({
      workerName: '王师傅',
      tasks: [unknownMachineTask],
    }).join('\n');

    expect(html).toContain('未识别机型');
    expect(impacts).toContain('“未识别机型”当前规则');
    expect(html).not.toContain('RAW_MACHINE');
    expect(impacts).not.toContain('RAW_MACHINE');
  });

  it('shows the real promised date and a status-specific navigation CTA', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[
          task('pending-1', TaskStatus.PENDING, '待开款式'),
          task(
            'progress-1',
            TaskStatus.IN_PROGRESS,
            '在制款式',
            false,
            null,
          ),
        ]}
      />,
    );

    expect(html).toContain('承诺交期：<span');
    expect(html).toContain('2026/08/27');
    expect(html).toContain('承诺交期：<span class="font-sans tabular-nums">未设置');
    expect(html).toMatch(
      /href="\/worker\/tasks\/pending-1"[\s\S]*?开始生产[\s\S]*?<\/a>/,
    );
    expect(html).toMatch(
      /href="\/worker\/tasks\/progress-1"[\s\S]*?报工[\s\S]*?<\/a>/,
    );
    expect(html).not.toMatch(/\b\d+%/);
  });

  it('weights only urgent row actions as solid and keeps regular actions outlined', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'WorkerTaskBatchList.tsx',
      ),
      'utf8',
    );

    expect(source).toContain("task.order.isUrgent && 'border-destructive/50'");
    expect(source).toContain(
      "variant: task.order.isUrgent ? 'default' : 'outline'",
    );
    expect(source).toContain("className: 'mt-3 min-h-12 min-w-24'");
  });

  it('keeps the completion trigger touch-sized and exposes dialog semantics', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        workerName="王师傅"
        tasks={[task('progress-1', TaskStatus.IN_PROGRESS, '在制款式')]}
      />,
    );

    expect(html).toContain('aria-label="批量处理任务" aria-busy="false"');
    expect(html).toMatch(
      /aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*class="[^"]*min-h-11[^"]*"/,
    );
  });

  it('locks all selection controls while a batch snapshot is pending', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'WorkerTaskBatchList.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<div className="space-y-3" aria-busy={pending}>');
    expect(source).toMatch(
      /function BatchCheckbox\(\{[\s\S]{0,120}?disabled = false/,
    );
    expect(source).toMatch(
      /checked=\{checked\}[\s\S]{0,100}?disabled=\{disabled\}/,
    );
    expect(source).toMatch(
      /checked=\{allSelected\}[\s\S]{0,120}?disabled=\{pending\}/,
    );
    expect(source).toMatch(
      /<WorkerTaskRow[\s\S]{0,160}?disabled=\{pending\}/,
    );
    expect(source).toMatch(
      /function toggle\(taskId: string\) \{\s*if \(pending\) return;/,
    );
    expect(source).toContain('peer-disabled:opacity-40');
  });
});

describe('WorkerTaskBatchList completion confirmation', () => {
  it('lists each order, task, craft, quantity, current worker and piecework impact', () => {
    const impacts = batchCompletionImpactItems({
      workerName: '王师傅',
      excludedPendingCount: 1,
      tasks: [task('progress-1', TaskStatus.IN_PROGRESS, '卡纸盒')],
    }).join('\n');

    expect(impacts).toContain('本次仅完工 1 个进行中任务');
    expect(impacts).toContain('不良数和返工数均为 0');
    expect(impacts).toContain('工单 PS-progress-1');
    expect(impacts).toContain('任务 #1 卡纸盒');
    expect(impacts).toContain('工艺 模切');
    expect(impacts).toContain('计划/合格数量 5,000');
    expect(impacts).toContain('当前师傅 王师傅');
    expect(impacts).toContain('“开机仔”当前规则');
    expect(impacts).toContain(
      '另外选中的 1 个待开始任务不在本次完工范围内',
    );
  });

  it('states the exact all-or-nothing completion result', () => {
    const impacts = batchCompletionImpactItems({
      workerName: '王师傅',
      tasks: [
        task('progress-1', TaskStatus.IN_PROGRESS, '在制款式'),
        task('progress-2', TaskStatus.IN_PROGRESS, '在制款式二'),
      ],
    }).join('\n');

    expect(impacts).toContain('任一任务在提交时不符合条件');
    expect(impacts).toContain('本批任务都不会完工');
    expect(impacts).not.toContain('逐项成功');
  });

  it('describes hourly work without inventing a piecework amount', () => {
    const hourlyTask = {
      ...task('packer-1', TaskStatus.IN_PROGRESS, '打包任务'),
      workerType: WorkerType.PACKER,
      machineType: null,
    };
    const impacts = batchCompletionImpactItems({
      workerName: '李师傅',
      tasks: [hourlyTask],
    }).join('\n');

    expect(impacts).toContain('按“打包工”时薪结算');
    expect(impacts).toContain('不生成计件工资');
  });

  it('validates the client snapshot before opening confirmation', () => {
    expect(
      validateBatchCompletionPreview([
        task('progress-1', TaskStatus.IN_PROGRESS, '在制款式'),
      ]),
    ).toBeNull();
    expect(validateBatchCompletionPreview([])).toBe(
      '请至少选择一个进行中任务',
    );
    expect(
      validateBatchCompletionPreview(
        Array.from({ length: 51 }, (_, index) =>
          task(
            `progress-${index}`,
            TaskStatus.IN_PROGRESS,
            `任务 ${index}`,
          ),
        ),
      ),
    ).toBe('单次最多完工 50 个任务');
    expect(
      validateBatchCompletionPreview([
        {
          ...task('bad-quantity', TaskStatus.IN_PROGRESS, '异常任务'),
          plannedQty: 0,
        },
      ]),
    ).toContain('计划数量异常');
  });

  it('routes completion through the shared L2 dialog instead of executing on trigger click', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'WorkerTaskBatchList.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<ConfirmActionDialog');
    expect(source).toContain('level="L2"');
    expect(source).toContain('onClick={prepareCompletionConfirmation}');
    expect(source).toContain('onConfirm={confirmCompletion}');
    expect(source).not.toContain(
      'onClick={() => run(reportTasksAction, selectedInProgress)}',
    );
  });
});
