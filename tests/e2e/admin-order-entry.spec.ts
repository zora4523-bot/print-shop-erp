import { expect, test } from "@playwright/test";
import { Client } from "pg";
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
  getUserIdByUsername,
} from "./_helpers";

test.describe("admin order entry", () => {
  test.describe.configure({ timeout: 120_000 });
  test("selects an external salesperson, restores the recipient, validates bags, and creates an owned draft", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await login(page, {
      from: "/orders/new",
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
    const ownerId = await getUserIdByUsername(E2E_USERS.owner!.username);
    const recipient = page.getByRole("combobox", {
      name: "关联外部销售（必填）",
    });
    await expect(recipient).toBeVisible();
    await expect(page.getByLabel("客户名称/简称", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("关联客户（选填）")).toHaveCount(0);
    await expect(page.getByLabel("版组 / 模具组 ID")).toHaveCount(0);
    await expect(page.getByLabel("专版计价组")).toHaveCount(0);
    await recipient.selectOption(salesId);
    const name = `外部销售代录 ${Date.now()}`;
    await page
      .getByRole("textbox", { name: "工单名称", exact: true })
      .fill(name);
    await page
      .getByRole("spinbutton", { name: "数量", exact: true })
      .fill("1200");
    const pack = page.getByRole("spinbutton", {
      name: "每包数量",
      exact: true,
    });
    await expect(pack).toHaveAttribute("max", "12");
    await pack.fill("13");
    await expect(
      page.getByText("每包数量不能超过 12 个，请调整包装数量").first(),
    ).toBeVisible();
    expect(
      await pack.evaluate(
        (input: HTMLInputElement) => input.validity.rangeOverflow,
      ),
    ).toBe(true);
    await pack.fill("12");
    await page
      .getByRole("textbox", { name: "收货地址", exact: true })
      .fill("张先生 13800138000 广东省佛山市南海区测试路1号");
    await expect
      .poll(async () =>
        page.evaluate(() =>
          Object.entries(localStorage).some(
            ([key, value]) =>
              key.includes("order") &&
              value.includes("externalSalesUserId") &&
              value.includes("外部销售代录"),
          ),
        ),
      )
      .toBe(true);
    await page.reload();
    await page.getByRole("button", { name: /恢复.*草稿/ }).click();
    await expect(recipient).toHaveValue(salesId);
    await expect(pack).toHaveValue("12");
    await expect(
      page.getByRole("textbox", { name: "工单名称", exact: true }),
    ).toHaveValue(name);
    await expect(
      page.getByRole("button", { name: "保存草稿", exact: true }),
    ).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+$/, { timeout: 45_000 });
    const id = new URL(page.url()).pathname.split("/")[2]!;
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const result = await db.query(
        'SELECT "submitterId", "createdById", "submitterRole", "settlementType", "customerPartyId", "customerRef", status, "priceRevision" FROM "Order" WHERE id=$1',
        [id],
      );
      expect(result.rows[0]).toEqual({
        submitterId: salesId,
        createdById: ownerId,
        submitterRole: "SALES",
        settlementType: "EXTERNAL_SALES",
        customerPartyId: null,
        customerRef: null,
        status: "DRAFT",
        priceRevision: 0,
      });
      const lines = await db.query(
        'SELECT "unitsPerBag" FROM "OrderPackagingGroupLine" WHERE "orderId"=$1',
        [id],
      );
      expect(lines.rows).toEqual([{ unitsPerBag: 12 }]);
      // Upload transport has separate ownership tests; supply a registered
      // design to exercise the real submit finalizer and price snapshot.
      await db.query(
        `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileName","fileUrl","fileType","fileSize","uploadedBy")
        SELECT $1,id,'代录测试.png',$2,'IMAGE',100,$3 FROM "OrderItem" WHERE "orderId"=$4`,
        [
          `${id}-test-design`,
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/%3E',
          ownerId,
          id,
        ],
      );
    } finally {
      await db.end();
    }
    await page.context().clearCookies();
    await login(page, {
      from: `/orders/${id}`,
      username: E2E_USERS.sales.username,
      password: E2E_PASSWORD,
    });
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "提交工单", exact: true }).click();
    await page
      .getByRole("button", { name: "确认最新报价并提交", exact: true })
      .click();
    const verifyDb = new Client({ connectionString: process.env.DATABASE_URL });
    await verifyDb.connect();
    try {
      await expect
        .poll(
          async () =>
            (
              await verifyDb.query('SELECT status FROM "Order" WHERE id=$1', [
                id,
              ])
            ).rows[0].status,
        )
        .toBe("CONFIRMED");
      const saved = (
        await verifyDb.query(
          'SELECT "priceRevision", "quotedFee", "submitterId", "createdById" FROM "Order" WHERE id=$1',
          [id],
        )
      ).rows[0];
      expect(saved).toMatchObject({
        // The submit snapshot and automatic production-readiness confirmation
        // are separate, audited pricing revisions.
        priceRevision: 2,
        submitterId: salesId,
        createdById: ownerId,
      });
      expect(Number(saved.quotedFee)).toBeGreaterThan(0);
    } finally {
      await verifyDb.end();
    }
    expect(errors).toEqual([]);
  });

  test("admin must choose an external salesperson and mixed bags validate the total", async ({
    page,
  }) => {
    await login(page, {
      from: "/orders/new",
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
    const recipient = page.getByRole("combobox", {
      name: "关联外部销售（必填）",
    });
    await expect(recipient).toHaveValue("");
    await page
      .getByRole("textbox", { name: "工单名称", exact: true })
      .fill(`管理员代建 ${Date.now()}`);
    // 分层建单（64c9a350）没有「复制当前」：「＋ 增加设计款」同样复制当前款并切过去。
    await page.getByRole("button", { name: "＋ 增加设计款", exact: true }).click();
    // 业主 2026-09-26：新增设计款的名称留空、须手动填写，且与第 1 款不重名。
    const secondDesignName = page.getByRole("textbox", { name: "设计款名称", exact: true });
    await expect(secondDesignName).toHaveValue("");
    await secondDesignName.fill("第二设计款");
    await page
      .getByRole("group", { name: "包装方式", exact: true })
      .getByRole("button", { name: "混装", exact: true })
      .click();
    await expect(
      page.getByText("每包数量不能超过 12 个，请调整包装数量").first(),
    ).toBeVisible();
    // 混装组的每个规格在整单包装区各占一行。
    const packs = page.getByRole("spinbutton", { name: "每包数量", exact: true });
    await expect(packs).toHaveCount(2);
    await packs.nth(0).fill("6");
    await packs.nth(1).fill("6");
    await expect(
      page.getByText("每包数量不能超过 12 个，请调整包装数量"),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "收货地址", exact: true })
      .fill("张先生 13800138000 广东省佛山市南海区测试路1号");
    // 业主 2026-09-24：管理员建单必须归属一个外部销售，未选择时就地拦截。
    await expect(
      page.getByRole("button", { name: "保存草稿", exact: true }),
    ).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(recipient).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("请选择关联外部销售").first()).toBeVisible();
    // 保存草稿只拦外部销售：焦点落在销售下拉，不亮出提交阶段才要求的设计图等校验。
    await expect(recipient).toBeFocused();
    await expect(page.getByText(/请上传设计图/)).toHaveCount(0);
    await expect(page).toHaveURL(/\/orders\/new/);
    await recipient.selectOption(salesId);
    await expect(recipient).toHaveAttribute("aria-invalid", "false");
    await expect(
      page.getByRole("button", { name: "保存草稿", exact: true }),
    ).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+$/, { timeout: 45_000 });
    const id = new URL(page.url()).pathname.split("/")[2]!;
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const result = await db.query(
        'SELECT "submitterId", "submitterRole", "settlementType", "customerRef", "customerPartyId" FROM "Order" WHERE id=$1',
        [id],
      );
      expect(result.rows[0]).toEqual({
        submitterId: salesId,
        submitterRole: "SALES",
        settlementType: "EXTERNAL_SALES",
        customerRef: null,
        customerPartyId: null,
      });
      const lines = await db.query(
        'SELECT "unitsPerBag" FROM "OrderPackagingGroupLine" WHERE "orderId"=$1',
        [id],
      );
      expect(lines.rows).toEqual([{ unitsPerBag: 6 }, { unitsPerBag: 6 }]);
    } finally {
      await db.end();
    }
  });
});
