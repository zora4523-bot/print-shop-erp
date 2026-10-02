import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { AccountsTable } from '../AccountsTable';
import '@/app/globals.css';
it('keeps the mobile account action at least 44px in both themes', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    flushSync(() => root.render(<AccountsTable accounts={[{ id: 'account', username: 'account', displayName: '账号', phone: null, role: 'SALES', workerType: null, machineType: null,
      isActive: true, employmentType: 'TEMPORARY', employmentStartDate: null, employmentEndDate: null, createdAt: new Date(), updatedAt: new Date() }]} />));
    for (const width of [375, 393, 768]) {
      await page.viewport(width, 900);
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle('dark', dark);
        const target = page.getByRole('link', { name: '编辑账号', exact: true });
        await expect.element(target).toBeVisible();
        expect(target.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      }
    }
  } finally { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); }
});
