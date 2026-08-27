import { randomUUID } from 'node:crypto';
import { Suspense } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRightLeft,
  ClipboardCheck,
  History,
  MapPin,
  PackageCheck,
  PackageOpen,
  ShieldCheck,
  Warehouse,
} from 'lucide-react';
import { createStockTransferAction } from '@/actions/owner-inventory';
import { PurchaseOrderStatusBadge } from '@/components/business/purchase/PurchaseStatusBadge';
import { StockTransferForm } from '@/components/business/warehouse/StockTransferForm';
import { WarehouseForms } from '@/components/business/warehouse/WarehouseForms';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ErrorBoundary,
  PageHeader,
  SlowLoadingHint,
  StatCard,
  TableEmptyState,
  TableScrollArea,
} from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { formatDateShanghai, formatDateTimeShanghai } from '@/lib/format/dates';
import { listRecentInventoryCounts } from '@/lib/inventory-count-posting';
import { txReasonLabel } from '@/lib/material-labels';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { listRecentStockTransfers } from '@/lib/stock-transfer';
import { getWarehouseDashboard } from '@/lib/warehouse';

export const metadata = {
  title: '仓库作业台 · 红包印刷 ERP',
};

type WarehouseDashboardPromise = ReturnType<typeof getWarehouseDashboard>;
type RecentStockTransfersPromise = ReturnType<typeof listRecentStockTransfers>;
type RecentInventoryCountsPromise = ReturnType<
  typeof listRecentInventoryCounts
>;

export default async function OwnerWarehousesPage() {
  await requirePermission('warehouse:manage');

  // 权限通过后立即、且各自只启动一次。每个消费区独立等待，避免一个读失败
  // 把其他已成功区域和合法操作一起隐藏。
  const dashboardPromise = getWarehouseDashboard();
  const recentTransfersPromise = listRecentStockTransfers(8);
  const recentCountsPromise = listRecentInventoryCounts(8);

  return (
    <div className="space-y-6">
      <PageHeader
        title="仓库作业台"
        subtitle="库存仅在收货过账后增加。"
        actions={
          <Link href="/owner/materials/count" className={buttonVariants()}>
            <ClipboardCheck aria-hidden />
            库存盘点
          </Link>
        }
      />

      <ErrorBoundary
        scope="section"
        title="仓库作业数据暂时无法加载"
        description="页头、盘点入口及最近单据仍可使用；请重试仓库作业区域。"
      >
        <Suspense fallback={<WarehouseDashboardSkeleton />}>
          <WarehouseDashboardContent dashboardPromise={dashboardPromise} />
        </Suspense>
      </ErrorBoundary>

      <section className="grid gap-6 xl:grid-cols-2" aria-label="最近仓库单据">
        <ErrorBoundary
          scope="section"
          title="最近调拨单暂时无法加载"
          description="其他仓库数据仍可使用；请重试最近调拨单区域。"
          className="h-full"
        >
          <Suspense fallback={<DocumentListSkeleton title="最近调拨单" />}>
            <RecentStockTransfersContent
              recentTransfersPromise={recentTransfersPromise}
            />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary
          scope="section"
          title="最近盘点单暂时无法加载"
          description="其他仓库数据仍可使用；请重试最近盘点单区域。"
          className="h-full"
        >
          <Suspense fallback={<DocumentListSkeleton title="最近盘点单" />}>
            <RecentInventoryCountsContent
              recentCountsPromise={recentCountsPromise}
            />
          </Suspense>
        </ErrorBoundary>
      </section>

      <ErrorBoundary
        scope="section"
        title="仓库与库位设置暂时无法加载"
        description="页头、盘点入口及最近单据仍可使用；请重试仓库设置区域。"
      >
        <Suspense fallback={<WarehouseSettingsSkeleton />}>
          <WarehouseSettingsContent dashboardPromise={dashboardPromise} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

async function WarehouseDashboardContent({
  dashboardPromise,
}: {
  dashboardPromise: WarehouseDashboardPromise;
}) {
  const dashboard = await dashboardPromise;
  const integrityOk = dashboard.metrics.integrityMismatchCount === 0;

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="启用仓库" value={`${dashboard.metrics.warehouseCount}`} icon={Warehouse} tone="info" />
        <StatCard label="启用库位" value={`${dashboard.metrics.activeLocationCount}`} icon={MapPin} tone="info" />
        <StatCard label="有库存库位" value={`${dashboard.metrics.stockPositionCount}`} icon={PackageCheck} tone="primary" />
        <StatCard label="待收货明细" value={`${dashboard.metrics.pendingReceiptLineCount}`} icon={PackageOpen} tone={dashboard.metrics.pendingReceiptLineCount ? 'warning' : 'success'} />
        <StatCard label="今日收货单" value={`${dashboard.metrics.todayReceiptCount}`} icon={History} tone="success" />
        <StatCard
          label="库存一致性"
          value={integrityOk ? '正常' : `${dashboard.metrics.integrityMismatchCount} 项异常`}
          icon={integrityOk ? ShieldCheck : AlertTriangle}
          tone={integrityOk ? 'success' : 'warning'}
        />
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">采购待收货</h2>
            <p className="text-sm text-muted-foreground">到货后在采购单中选择实际库位收货；支持分批收货。</p>
          </div>
          <Link href="/owner/purchases" className={buttonVariants({ variant: 'outline' })}>查看采购单</Link>
        </div>
        <TableScrollArea label="采购待收货明细">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2">采购单</th><th className="px-3 py-2">供应商</th><th className="px-3 py-2">物料</th><th className="px-3 py-2 text-right">订购</th><th className="px-3 py-2 text-right">已收</th><th className="px-3 py-2 text-right">待收</th><th className="px-3 py-2">预计日期</th>
            </tr></thead>
            <tbody>
              {dashboard.pendingReceipts.length === 0 ? <EmptyRow columns={7} text="暂无待收货明细" /> : dashboard.pendingReceipts.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-3 py-2"><Link className="font-sans tabular-nums text-primary hover:underline" href={`/owner/purchases/${item.purchaseOrder.id}`}>{item.purchaseOrder.purchaseNo}</Link><div><PurchaseOrderStatusBadge status={item.purchaseOrder.status} /></div></td>
                  <td className="px-3 py-2">{item.purchaseOrder.supplierName}</td>
                  <td className="px-3 py-2"><div>{externalPriceBusinessText(item.material.name)}</div><div className="font-sans tabular-nums text-xs text-muted-foreground">{item.material.code}</div></td>
                  <td className="px-3 py-2 text-right font-sans tabular-nums">{item.orderedQuantity} {item.material.unit}</td>
                  <td className="px-3 py-2 text-right font-sans tabular-nums">{item.receivedQuantity} {item.material.unit}</td>
                  <td className="px-3 py-2 text-right font-sans tabular-nums font-semibold">{item.remainingQuantity} {item.material.unit}</td>
                  <td className="px-3 py-2">{formatDateShanghai(item.purchaseOrder.expectedDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 font-semibold"><ArrowRightLeft className="size-4" aria-hidden />库位调拨</h2>
          <p className="text-sm text-muted-foreground">调拨会同时减少来源库存并增加目标库存；任一步失败则不生效。</p>
        </div>
        <StockTransferForm
          action={createStockTransferAction}
          materials={dashboard.materials}
          locations={dashboard.locations}
          locationStocks={dashboard.locationStocks.map((stock) => ({ materialId: stock.materialId, locationId: stock.locationId, currentStock: stock.currentStock }))}
          initialIdempotencyKey={randomUUID()}
        />
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">库存分布</h2>
        <TableScrollArea label="库存分布">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2">仓库 / 库位</th><th className="px-3 py-2">物料</th><th className="px-3 py-2 text-right">库存</th></tr></thead>
            <tbody>
              {dashboard.locationStocks.length === 0 ? <EmptyRow columns={3} text="暂无库位库存记录" /> : dashboard.locationStocks.map((stock) => (
                <tr key={`${stock.materialId}:${stock.locationId}`} className="border-b last:border-0">
                  <td className="px-3 py-2"><div>{stock.warehouse.name} / {stock.location.name}</div><div className="font-sans tabular-nums text-xs text-muted-foreground">{stock.warehouse.code} / {stock.location.code}</div></td>
                  <td className="px-3 py-2"><div>{externalPriceBusinessText(stock.material.name)}</div><div className="font-sans tabular-nums text-xs text-muted-foreground">{stock.material.code}</div></td>
                  <td className="px-3 py-2 text-right font-sans tabular-nums">{stock.currentStock} {stock.material.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-semibold">最近库存流水</h2>
        <TableScrollArea label="最近库存流水">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2">时间</th><th className="px-3 py-2">物料</th><th className="px-3 py-2">类型</th><th className="px-3 py-2">库位</th><th className="px-3 py-2 text-right">数量</th><th className="px-3 py-2">操作人</th></tr></thead>
            <tbody>
              {dashboard.recentTransactions.length === 0 ? <EmptyRow columns={6} text="暂无库存流水" /> : dashboard.recentTransactions.map((transaction) => (
                <tr key={transaction.id} className="border-b last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeShanghai(transaction.occurredAt)}</td>
                  <td className="px-3 py-2"><div>{externalPriceBusinessText(transaction.material.name)}</div><div className="font-sans tabular-nums text-xs text-muted-foreground">{transaction.material.code}</div></td>
                  <td className="px-3 py-2"><Badge variant={transaction.direction === 'IN' ? 'outline' : 'secondary'}>{transaction.direction === 'IN' ? '入库' : '出库'} · {txReasonLabel(transaction.reasonType)}</Badge></td>
                  <td className="px-3 py-2">{transaction.warehouse?.name ?? '—'} / {transaction.location?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-sans tabular-nums">{transaction.direction === 'IN' ? '+' : '-'}{transaction.quantity} {transaction.material.unit}</td>
                  <td className="px-3 py-2">{transaction.operator.displayName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      </section>

    </>
  );
}

async function RecentStockTransfersContent({
  recentTransfersPromise,
}: {
  recentTransfersPromise: RecentStockTransfersPromise;
}) {
  const recentTransfers = await recentTransfersPromise;

  return (
    <DocumentList
      title="最近调拨单"
      empty="暂无调拨单"
      rows={recentTransfers.map((transfer) => ({
        id: transfer.id,
        number: transfer.transferNo,
        description: `${externalPriceBusinessText(transfer.material.name)} · ${transfer.sourceLocation.warehouse.name}/${transfer.sourceLocation.name} → ${transfer.destinationLocation.warehouse.name}/${transfer.destinationLocation.name}`,
        quantity: `${transfer.quantity} ${transfer.material.unit}`,
        time: formatDateTimeShanghai(transfer.occurredAt),
      }))}
    />
  );
}

async function RecentInventoryCountsContent({
  recentCountsPromise,
}: {
  recentCountsPromise: RecentInventoryCountsPromise;
}) {
  const recentCounts = await recentCountsPromise;

  return (
    <DocumentList
      title="最近盘点单"
      empty="暂无盘点单"
      rows={recentCounts.map((count) => ({
        id: count.id,
        number: count.countNo,
        description: `${count.items.length} 条库位明细 · ${count.countedBy.displayName}`,
        quantity: `${count.items.filter((item) => Number(item.difference) !== 0).length} 条差异`,
        time: formatDateTimeShanghai(count.countedAt),
      }))}
    />
  );
}

async function WarehouseSettingsContent({
  dashboardPromise,
}: {
  dashboardPromise: WarehouseDashboardPromise;
}) {
  const dashboard = await dashboardPromise;

  return (
    <Disclosure className="rounded-xl border bg-card p-5 shadow-sm">
      <DisclosureSummary className="font-semibold">
        仓库与库位设置
      </DisclosureSummary>
      <div className="mt-5 space-y-5">
        <WarehouseForms
          warehouses={dashboard.warehouses.map((warehouse) => ({
            id: warehouse.id,
            code: warehouse.code,
            name: warehouse.name,
            isActive: warehouse.isActive,
          }))}
        />
        <div className="space-y-4">
          {dashboard.warehouses.map((warehouse) => (
            <div key={warehouse.id} className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{warehouse.name}</div>
                  <div className="font-sans tabular-nums text-xs text-muted-foreground">
                    {warehouse.code}
                  </div>
                </div>
                <div className="flex gap-2">
                  {warehouse.isDefault ? (
                    <Badge variant="outline">默认</Badge>
                  ) : null}
                  <Badge
                    variant={warehouse.isActive ? 'outline' : 'secondary'}
                  >
                    {warehouse.isActive ? '启用' : '停用'}
                  </Badge>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {warehouse.locations.map((location) => (
                  <div
                    key={location.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div>
                      <div>{location.name}</div>
                      <div className="font-sans tabular-nums text-xs text-muted-foreground">
                        {location.code}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {location.isDefault ? (
                        <Badge variant="outline">默认</Badge>
                      ) : null}
                      <Badge
                        variant={location.isActive ? 'outline' : 'secondary'}
                      >
                        {location.isActive ? '启用' : '停用'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Disclosure>
  );
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <TableEmptyState colSpan={columns} title={text} />;
}

function DocumentList({ title, empty, rows }: { title: string; empty: string; rows: { id: string; number: string; description: string; quantity: string; time: string }[] }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <div className="space-y-3">{rows.map((row) => <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"><div><div className="font-sans tabular-nums text-sm font-medium">{row.number}</div><div className="mt-1 text-xs text-muted-foreground">{row.description}</div><div className="mt-1 text-xs text-muted-foreground">{row.time}</div></div><Badge variant="outline">{row.quantity}</Badge></div>)}</div>}
    </div>
  );
}

function WarehouseDashboardSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">正在加载仓库数据</span>
      <div
        aria-hidden="true"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
            <Skeleton className="h-4 w-20 motion-reduce:animate-none" />
            <Skeleton className="h-7 w-16 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="space-y-4 rounded-xl border bg-card p-5 shadow-sm"
        >
          <Skeleton className="h-5 w-28 motion-reduce:animate-none" />
          <Skeleton className="h-28 w-full motion-reduce:animate-none" />
        </div>
      ))}
      <SlowLoadingHint />
    </section>
  );
}

function DocumentListSkeleton({ title }: { title: string }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="h-full space-y-4 rounded-xl border bg-card p-5 shadow-sm"
    >
      <h2 className="font-semibold">{title}</h2>
      <span className="sr-only">正在加载{title}</span>
      <div aria-hidden="true" className="space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-20 w-full motion-reduce:animate-none"
          />
        ))}
      </div>
      <SlowLoadingHint />
    </div>
  );
}

function WarehouseSettingsSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm"
    >
      <span className="sr-only">正在加载仓库与库位设置</span>
      <Skeleton
        aria-hidden="true"
        className="h-6 w-40 motion-reduce:animate-none"
      />
      <SlowLoadingHint />
    </div>
  );
}
