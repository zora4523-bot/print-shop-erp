import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { ProductionOperationStatus } from '@/generated/prisma/enums';
import { WorkerOrderTaskList, type WorkerOrderTaskCard } from '../WorkerOrderTaskList';
import '@/app/globals.css';

vi.mock('next/link', () => ({
  __esModule: true,
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'worker-viewport mx-auto max-w-xl p-4';
  host.dataset.testid = 'worker-task-picker';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

const packagingTasks: WorkerOrderTaskCard[] = [1, 2, 3, 4].map((sequence) => ({
  id: `pack-${sequence}`,
  title: `包装组 #${sequence} · 中秋礼盒独立包装`,
  sources: [`#${sequence} · 花好月圆 · 每袋 10 个`, '#5 · 阖家团圆款 · 每袋 5 个'],
  status: sequence === 4 ? ProductionOperationStatus.COMPLETED : ProductionOperationStatus.IN_PROGRESS,
  planned: '200', completed: sequence === 4 ? '200' : '120', remaining: sequence === 4 ? '0' : '80', unit: '袋', myAmount: '¥ 1.50',
}));

function mount(operations = packagingTasks, progressSteps: WorkerOrderTaskCard[] = []) {
  flushSync(() => root.render(<WorkerOrderTaskList reporterName="王阿姨" laneLabel="打包入袋" operations={operations} progressSteps={progressSteps} />));
}

describe('工单统一扫码任务选择', () => {
  for (const dark of [false, true]) {
    for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
      it(`${dark ? '深色' : '浅色'} ${width}×${height} 包装组可区分、无溢出且触控达标`, async () => {
        await page.viewport(width!, height!);
        document.documentElement.classList.toggle('dark', dark);
        mount();
        await expect.element(page.getByText('王阿姨 · 打包入袋')).toBeVisible();
        await expect.element(page.getByText('包装组 #1 · 中秋礼盒独立包装')).toBeVisible();
        await expect.element(page.getByText('包装组 #4 · 中秋礼盒独立包装')).not.toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width!);
        for (const element of host.querySelectorAll<HTMLElement>('a, summary')) {
          if (!element.checkVisibility()) continue;
          const rect = element.getBoundingClientRect();
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
          expect(rect.right).toBeLessThanOrEqual(width!);
        }
        expect(await commands.checkShellAccessibility('[data-testid="worker-task-picker"]')).toEqual([]);
      });
    }
  }

  it('完成工序折叠保留查看入口，所有任务完成时不显示报工入口', async () => {
    mount([packagingTasks[3]!]);
    await expect.element(page.getByText('本组工序已完成，暂无待报工任务。')).toBeVisible();
    await page.getByText('已完成工序 · 1').click();
    const link = page.getByRole('link', { name: /包装组 #4/ });
    await expect.element(link).toBeVisible();
    await expect.element(link).toHaveAttribute('href', '/worker/tasks/pack-4');
    await expect.element(page.getByText('进入报工 →')).not.toBeInTheDocument();
  });

  it('共享进度与计件分组，清楚标注不计薪', async () => {
    mount([], [{ id: 'clean-1', title: '清废', sources: ['#1 · 花好月圆'], status: ProductionOperationStatus.PENDING, planned: '2000', completed: '1500', remaining: '500', unit: '个' }]);
    await expect.element(page.getByText('当前工单没有本岗位计件工序。')).toBeVisible();
    await expect.element(page.getByText('仅推进生产进度，不计入工资。')).toBeVisible();
    await expect.element(page.getByRole('link', { name: /清废/ })).toHaveAttribute('href', '/worker/tasks/clean-1');
  });
});

// 审计 L-8：他车道进度点进去会 404，只能作为只读行展示，不渲染链接。
it('他岗位进度只读展示，不提供报工链接', async () => {
  mount([], [
    { id: 'emboss-1', title: '压凹', sources: ['#1 · 花好月圆'], status: ProductionOperationStatus.PENDING, planned: '2000', completed: '0', remaining: '2000', unit: '个' },
    { id: 'glue-1', title: '粘盒', sources: ['#1 · 花好月圆'], status: ProductionOperationStatus.PENDING, planned: '2000', completed: '0', remaining: '2000', unit: '个', readOnly: true },
  ]);
  await expect.element(page.getByRole('link', { name: /压凹/ })).toHaveAttribute('href', '/worker/tasks/emboss-1');
  await expect.element(page.getByText('粘盒')).toBeVisible();
  await expect.element(page.getByRole('link', { name: /粘盒/ })).not.toBeInTheDocument();
  await expect.element(page.getByText('由其他岗位报工')).toBeVisible();
  expect(host.querySelector('a[href="/worker/tasks/glue-1"]')).toBeNull();
});
