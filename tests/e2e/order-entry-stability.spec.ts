import { expect, test, type Locator } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

async function top(locator: Locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().top);
}

for (const actor of ['owner', 'sales'] as const) {
  for (const width of [393, 1280]) {
    test(`${actor} ${width}: entry fields stay usable through validation and quotes`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      const quoteResponses: number[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (new URL(response.url()).pathname === '/orders/new' && response.request().method() === 'POST') {
          quoteResponses.push(response.status());
        }
      });
      await login(page, { from: '/orders/new', username: E2E_USERS[actor]!.username, password: E2E_PASSWORD });
      const quantity = page.getByRole('spinbutton', { name: '数量', exact: true });
      const pack = page.getByRole('spinbutton', { name: '每包数量', exact: true });
      await expect(quantity).toBeEnabled();
      await quantity.scrollIntoViewIfNeeded();
      await quantity.click();
      const packTop = await top(pack);
      await quantity.fill('');
      await expect(quantity).toHaveAttribute('aria-invalid', 'true');
      expect(await top(pack)).toBe(packTop);
      await quantity.fill('1200');
      await expect(quantity).toHaveAttribute('aria-invalid', 'false');
      expect(await top(pack)).toBe(packTop);

      const mode = page.getByRole('group', { name: '包装方式', exact: true });
      await pack.scrollIntoViewIfNeeded();
      await pack.click();
      const modeTop = await top(mode);
      await pack.fill('13');
      await expect(pack).toHaveAttribute('aria-invalid', 'true');
      expect(await top(mode)).toBe(modeTop);
      await pack.fill('12');
      await expect(pack).toHaveAttribute('aria-invalid', 'false');
      expect(await top(mode)).toBe(modeTop);

      await page.getByRole('button', { name: /复制当前/ }).click();
      await pack.fill('6');
      const styles = page.getByRole('navigation', { name: '款式', exact: true }).getByRole('button');
      await expect(styles).toHaveCount(2);
      await styles.first().click();
      await expect(pack).toHaveValue('12');
      await expect(quantity).toHaveValue('1200');
      await styles.last().click();
      await expect(pack).toHaveValue('6');
      await page.getByRole('button', { name: '删除第 2 款', exact: true }).click();
      await expect(styles).toHaveCount(1);
      await expect(pack).toHaveValue('12');

      const address = page.getByRole('textbox', { name: '收货地址', exact: true });
      await address.fill('张先生 13800138000 广东省佛山市南海区测试路1号');
      const name = page.getByRole('textbox', { name: '收件人', exact: true });
      const phone = page.getByRole('textbox', { name: '收货电话', exact: true });
      await expect(name).toHaveValue('张先生');
      await expect(phone).toHaveValue('13800138000');
      await name.fill('修改后的收件人');
      await phone.fill('13800138001');
      await address.pressSequentially('二楼');
      await expect(address).toBeFocused();
      await expect(name).toHaveValue('修改后的收件人');
      await expect(phone).toHaveValue('13800138001');

      await page.getByRole('button', { name: '添加地址 2', exact: true }).click();
      const extraAddress = page.getByLabel('详细地址', { exact: true });
      await page.getByRole('group', { name: '款式分配数量', exact: true }).getByRole('spinbutton').fill('600');
      await extraAddress.fill('广东省广州市越秀区测试路2号');
      await extraAddress.pressSequentially('三楼');
      await expect(extraAddress).toBeFocused();
      await expect(extraAddress).toHaveValue('广东省广州市越秀区测试路2号三楼');

      // 不再用 waitForResponse 按 postData 匹配报价请求：Server Action 的请求体
      // 可能以流式发送，Playwright 的 postData() 为 null，谓词永远不成立，
      // 四个变体会随机超时（CI 第八轮与本地各挂两个）。改为等费用栏按新数量
      // 更新并脱离「核价中 / 待重新核价」状态。
      const rail = page.locator('[data-slot="order-form-rail"]');
      const railBefore = await rail.innerText();
      await quantity.fill('1260');
      await extraAddress.click();
      const addressTop = await top(extraAddress);
      await expect
        .poll(async () => {
          const text = await rail.innerText();
          return text !== railBefore && !/核价中…|待重新核价/.test(text);
        }, { timeout: 30_000, message: '费用栏应按数量 1260 重新报价完成' })
        .toBe(true);
      expect(quoteResponses.every((status) => status === 200)).toBe(true);
      await expect(extraAddress).toBeFocused();
      expect(await top(extraAddress)).toBe(addressTop);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    });
  }
}
