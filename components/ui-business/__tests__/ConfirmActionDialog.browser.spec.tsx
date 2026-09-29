import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { Button } from '@/components/ui/button';
import { ConfirmActionController, ConfirmActionDialog } from '../ConfirmActionDialog';
import '@/app/globals.css';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  document.documentElement.lang = 'zh-CN';
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});
const consequence = '批准后待开工数量更新为 1,500 个。';
const changes = [
  { label: '数量', old: '1,000 个', new: '1,500 个' },
  { label: '金额（增加 ¥96.50）', old: '¥193.30', new: '¥289.80' },
];
function mount(level: 'L2' | 'L3' = 'L2', disabled = false) {
  const confirm = vi.fn();
  flushSync(() => root.render(
    <main>
      <h1>工单修改</h1>
      <ConfirmActionController level={level} disabled={disabled}
        trigger={<Button>复核变更</Button>} onConfirm={confirm}>
        <ConfirmActionDialog action="批准变更" changes={changes}
          consequences={[consequence, consequence]} confirmText="批准" />
      </ConfirmActionController>
    </main>,
  ));
  return confirm;
}

for (const [width, height] of [[360, 800], [390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]]) {
  for (const dark of [false, true]) {
    it(`renders facts once and stays accessible at ${width}x${height} ${dark ? 'dark' : 'light'}`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', dark);
      mount();
      expect(document.body.textContent).not.toContain(consequence);
      await page.getByRole('button', { name: '复核变更', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect.element(dialog).toBeVisible();
      expect(document.body.textContent?.split(consequence)).toHaveLength(2);
      expect(document.body.textContent).not.toContain('请确认影响范围');
      expect(document.body.textContent).toContain('¥193.30');
      expect(document.body.textContent).toContain('¥289.80');
      const element = document.querySelector('[role="alertdialog"]')!;
      const box = element.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(height);
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      expect(await commands.checkShellAccessibility('[role="alertdialog"]')).toEqual([]);
      await userEvent.keyboard('{Escape}');
      await expect.element(dialog).not.toBeInTheDocument();
      await expect.poll(() => document.activeElement?.textContent).toBe('复核变更');
    });
  }
}

it('preserves reason requirements, keyboard submission, cancellation and reason clearing', async () => {
  const confirm = mount('L3');
  await page.getByRole('button', { name: '复核变更' }).click();
  await expect.element(page.getByRole('button', { name: '批准', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '操作理由' }).fill('   ');
  await expect.element(page.getByRole('button', { name: '批准', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '操作理由' }).fill('客户增加数量');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(confirm).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '复核变更' }).click();
  await expect.element(page.getByRole('textbox', { name: '操作理由' })).toHaveValue('');
  await page.getByRole('textbox', { name: '操作理由' }).fill('客户增加数量');
  document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(confirm).toHaveBeenCalledExactlyOnceWith('客户增加数量');
});

it('keeps disabled operations inaccessible', async () => {
  const confirm = mount('L2', true);
  await expect.element(page.getByRole('button', { name: '复核变更' })).toBeDisabled();
  expect(confirm).not.toHaveBeenCalled();
});

it('submits the trimmed reason to the original external form', async () => {
  const submit = vi.fn();
  flushSync(() => root.render(<>
    <form id="confirmation-test-form" onSubmit={(event) => {
      event.preventDefault();
      submit(new FormData(event.currentTarget).get('reason'));
    }} />
    <ConfirmActionController level="L3" formId="confirmation-test-form" trigger={<Button>删除项目</Button>}>
      <ConfirmActionDialog action="删除项目" changes={[]} consequences={['删除后不可恢复。']} confirmText="删除" danger />
    </ConfirmActionController>
  </>));
  await page.getByRole('button', { name: '删除项目' }).click();
  await page.getByRole('textbox', { name: '操作理由' }).fill('  重复项目  ');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  expect(submit).toHaveBeenCalledExactlyOnceWith('重复项目');
});

it('requires the acknowledgement tick, keeps L3 non-red and renames the dismiss button for 取消 actions', async () => {
  const confirm = vi.fn();
  flushSync(() => root.render(
    <ConfirmActionController level="L3" trigger={<Button>取消工单</Button>} onConfirm={confirm}>
      <ConfirmActionDialog action="取消工单" changes={[]} consequences={['工单进入已取消。']}
        confirmText="取消工单" acknowledgement="我已通知客户" />
    </ConfirmActionController>,
  ));
  await page.getByRole('button', { name: '取消工单' }).click();
  const action = page.getByRole('button', { name: '取消工单', exact: true }).last();
  await expect.element(page.getByRole('button', { name: '暂不取消', exact: true })).toBeVisible();
  expect(document.querySelector('[data-slot="alert-dialog-action"]')!.className).not.toContain('text-destructive');
  await page.getByRole('textbox', { name: '操作理由' }).fill('客户撤单');
  await expect.element(action).toBeDisabled();
  await page.getByRole('checkbox', { name: '我已通知客户' }).click();
  await expect.element(action).toBeEnabled();
  await action.click();
  expect(confirm).toHaveBeenCalledExactlyOnceWith('客户撤单');
});
