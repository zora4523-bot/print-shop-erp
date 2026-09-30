import { RuleCenterPageHeader } from '@/components/business/rules/RuleCenterPageHeader';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableScrollArea } from '@/components/ui-business';
import { cn } from '@/lib/utils';

export type PricingNumericValue = number | string | null;

export type PricingNumericFieldState = {
  /** Stable DOM/form identifier. */
  id: string;
  /** Submitted field name; defaults to `id`. */
  name?: string;
  value: PricingNumericValue;
  editable?: boolean;
  disabled?: boolean;
  changed?: boolean;
};

export type PricingMatrixColumn = {
  key: string;
  label: string;
};

export type PricingMatrixCell = PricingNumericFieldState & {
  columnKey: string;
  emptyLabel?: string;
};

export type CustomerBlankPricingRow = {
  key: string;
  paperName: string;
  weight: number | string;
  cells: readonly PricingMatrixCell[];
};

export type CustomerBlankPricingSectionViewProps = {
  columns: readonly PricingMatrixColumn[];
  rows: readonly CustomerBlankPricingRow[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerMachinePricingSectionViewProps = {
  rate: PricingNumericFieldState;
  flatFee: PricingNumericFieldState;
  jumpQuantity: PricingNumericFieldState;
  plateFee: PricingNumericFieldState;
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerTierPricingRow = {
  key: string;
  name: string;
  maxQuantity: PricingNumericFieldState;
  middlePrice: PricingNumericFieldState;
  largePrice: PricingNumericFieldState;
};

export type CustomerTiersPricingSectionViewProps = {
  rows: readonly CustomerTierPricingRow[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerPricingAdjustmentRow = {
  key: string;
  label: string;
  description?: string;
  value: PricingNumericFieldState;
  unit: '元/个' | '元';
  isNew?: boolean;
};

export type CustomerAddsPricingSectionViewProps = {
  paperAdjustments: readonly CustomerPricingAdjustmentRow[];
  craftAdjustments: readonly CustomerPricingAdjustmentRow[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerPrintPricingRow = {
  key: string;
  label: string;
  cells: readonly PricingMatrixCell[];
};

export type CustomerPrintPricingSectionViewProps = {
  columns: readonly PricingMatrixColumn[];
  rows: readonly CustomerPrintPricingRow[];
  foilCells: readonly PricingMatrixCell[];
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

export type CustomerBagPricingFields = {
  normalFee: PricingNumericFieldState;
  mixedFee: PricingNumericFieldState;
};

export type CustomerCartonPricingTierRow = {
  key: string;
  name?: string;
  maxQuantity: PricingNumericFieldState;
  fee: PricingNumericFieldState;
};

export type CustomerCartonPricingFields = {
  tiers: readonly CustomerCartonPricingTierRow[];
  segmentLength: PricingNumericFieldState;
  segmentFee: PricingNumericFieldState;
};

export type CustomerShippingUnitWeightRow = {
  key: string;
  label: string;
  value: PricingNumericFieldState;
};

export type CustomerShippingZoneRow = {
  key: string;
  name: string;
  provinces: readonly string[];
  firstWeightFee: PricingNumericFieldState;
  incrementFee: PricingNumericFieldState;
  incrementKilograms: number;
};

export type CustomerShippingPricingFields = {
  unitWeights: readonly CustomerShippingUnitWeightRow[];
  maxQuantity: PricingNumericFieldState;
  zones: readonly CustomerShippingZoneRow[];
};

export type CustomerShipPricingSectionViewProps = {
  box?: readonly {label: string; field: PricingNumericFieldState}[];
  bag: CustomerBagPricingFields;
  carton: CustomerCartonPricingFields;
  shipping: CustomerShippingPricingFields;
  headingActions?: ReactNode;
  statusContent?: ReactNode;
  className?: string;
  headingId?: string;
};

type PricingNumericInputProps = PricingNumericFieldState & {
  ariaLabel: string;
  placeholder?: string;
  step?: number | string;
  className?: string;
  changedDot?: boolean;
};

type PricingSectionHeadingProps = {
  headingId: string;
  title: string;
  basis?: string;
  criticalBasis?: boolean;
  actions?: ReactNode;
};

const EMPTY_FIELD: PricingNumericFieldState = {
  id: 'missing-pricing-field',
  value: null,
  editable: false,
  disabled: true,
  changed: false,
};

function PricingSectionHeading({
  headingId,
  title,
  basis,
  criticalBasis = false,
  actions,
}: PricingSectionHeadingProps) {
  // 分区即页面：标题经 RuleCenterPageHeader / PageHeader（ui-规范 §8.3）。
  // 计价口径不同于相邻分区时用 primary 强调，不用红色（红色只表示危险 / 失败）。
  return (
    <RuleCenterPageHeader
      titleId={headingId}
      title={title}
      scope={basis}
      scopeEmphasis={criticalBasis}
      actions={actions}
    />
  );
}

function PricingNumericInput({
  id,
  name,
  value,
  editable = false,
  disabled = false,
  changed = false,
  ariaLabel,
  placeholder = '—',
  step,
  className,
  changedDot = false,
}: PricingNumericInputProps) {
  const label = `${ariaLabel}${changed ? '（有未发布改动）' : ''}`;
  const displayValue =
    value === null || value === '' ? placeholder : String(value);

  return (
    <div className="relative min-w-0">
      {editable && !disabled ? (
        <Input
          // The server action revalidates this view with the persisted value.
          // Remount only the changed field so Base UI receives a stable
          // defaultValue for each uncontrolled input instance. Other fields
          // keep their unsaved DOM values after a validation error.
          key={JSON.stringify([id, value ?? ''])}
          id={id}
          name={name ?? id}
          type="number"
          inputMode="decimal"
          defaultValue={value ?? ''}
          placeholder={placeholder}
          step={step}
          aria-label={label}
          data-changed={changed || undefined}
          className={cn(
            'h-8 min-w-0 text-right text-sm font-bold tabular-nums',
            changed &&
              'border-warning/50 bg-warning/10 text-warning-foreground',
            className,
          )}
        />
      ) : (
        <>
          <span className="sr-only">{label}，当前值：</span>
          <span
            id={id}
            data-price-label={label}
            data-readonly="true"
            data-disabled={disabled || undefined}
            data-changed={changed || undefined}
            className={cn(
              'flex h-8 min-w-0 items-center justify-end rounded-md border border-transparent bg-transparent px-3 text-right text-sm font-bold tabular-nums',
              (value === null || value === '') && 'text-muted-foreground',
              disabled && 'text-muted-foreground',
              changed &&
                'border-warning/50 bg-warning/10 text-warning-foreground',
              className,
            )}
          >
            {displayValue}
          </span>
        </>
      )}
      {changed && changedDot ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-warning"
        />
      ) : null}
    </div>
  );
}

function CardSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="border-b pb-2 text-xs font-semibold tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

function displayWeight(weight: number | string): string {
  if (typeof weight === 'number') return `${weight}g`;
  return /g$/i.test(weight.trim()) ? weight : `${weight}g`;
}

function finiteNumber(value: PricingNumericValue): number | null {
  if (value === null || value === '') return null;
  const normalized =
    typeof value === 'string' ? value.replaceAll(',', '').trim() : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerLabel(value: number): string {
  return Math.trunc(value).toLocaleString('zh-CN');
}

function decimalLabel(value: number, maximumFractionDigits = 3): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function matrixCell(
  cells: readonly PricingMatrixCell[],
  columnKey: string,
  fallbackId: string,
): PricingNumericFieldState {
  return (
    cells.find((cell) => cell.columnKey === columnKey) ?? {
      ...EMPTY_FIELD,
      id: fallbackId,
    }
  );
}

export function CustomerBlankPricingSectionView({
  columns,
  rows,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-blank-pricing-heading',
}: CustomerBlankPricingSectionViewProps) {
  const minimumWidth = Math.max(720, 176 + columns.length * 112);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="局部烫金 · 空白封现货单价"
        basis="元 / 个"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <Table label="局部烫金空白封现货单价矩阵" style={{ minWidth: minimumWidth }}>
            <TableHeader>
              <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                <TableHead className="w-44 px-4 text-xs font-semibold tracking-wide text-muted-foreground">
                  纸张 · 克重
                </TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className="min-w-28 px-2 text-right text-xs font-semibold tracking-wide text-muted-foreground"
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="hover:bg-transparent">
                  <TableCell className="px-4 py-2.5 text-left text-sm font-bold">
                    {row.paperName}
                    <span className="ml-1.5 font-mono text-xs font-semibold text-muted-foreground">
                      {displayWeight(row.weight)}
                    </span>
                  </TableCell>
                  {columns.map((column) => {
                    const field = matrixCell(
                      row.cells,
                      column.key,
                      `blank-${row.key}-${column.key}`,
                    );
                    return (
                      <TableCell key={column.key} className="p-1.5">
                        <PricingNumericInput
                          {...field}
                          ariaLabel={`${row.paperName}${displayWeight(row.weight)}${column.label}单价`}
                          placeholder={row.cells.find(cell => cell.columnKey === column.key)?.emptyLabel ?? '— 转人工'}
                          step="0.0001"
                          changedDot
                          className={cn(
                            'h-9 border-transparent bg-transparent px-2 text-right shadow-none',
                            field.value === null &&
                              'text-xs font-semibold placeholder:text-muted-foreground',
                            field.editable && 'hover:bg-muted/60',
                            field.changed &&
                              'border-warning/50 bg-warning/10 text-warning-foreground',
                          )}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function ParameterRow({
  label,
  description,
  field,
  unit,
  step,
  placeholder,
}: {
  label: ReactNode;
  description?: ReactNode;
  field: PricingNumericFieldState;
  unit: string;
  step?: number | string;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1 text-sm font-bold">
        <div>{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs font-medium leading-4 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <PricingNumericInput
        {...field}
        ariaLabel={typeof label === 'string' ? label : '价格参数'}
        placeholder={placeholder}
        step={step}
        className="w-[110px] shrink-0"
      />
      <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

export function CustomerMachinePricingSectionView({
  rate,
  flatFee,
  jumpQuantity,
  plateFee,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-machine-pricing-heading',
}: CustomerMachinePricingSectionViewProps) {

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="局部烫金 · 机烫费与制版费"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="divide-y px-4 sm:px-5">
          <ParameterRow
            label="费率"
            description="数量 ≥ 跳变点时，每次印刷"
            field={rate}
            unit="元/次"
            step="0.005"
          />
          <ParameterRow
            label="固定费"
            description="数量低于跳变点时，每次过版"
            field={flatFee}
            unit="元/次"
          />
          <ParameterRow
            label="跳变点"
            description="低于此数量走固定费"
            field={jumpQuantity}
            unit="个"
          />
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-3 sm:px-5">
          <div
            id={plateFee.id}
            role="note"
            className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
          >
            <div className="min-w-0">
              <div className="text-sm font-bold">制烫金版费</div>
            </div>
            <Badge
              variant="outline"
              className="h-auto w-fit shrink-0 rounded-md border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
            >
              默认 0 元 · 可人工添加
            </Badge>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function tierRanges(rows: readonly CustomerTierPricingRow[]) {
  let previousMax = 0;
  return rows.map((row, index) => {
    const lower = index === 0 ? 1 : previousMax + 1;
    const upper = finiteNumber(row.maxQuantity.value);
    const label =
      upper === null
        ? `≥ ${integerLabel(lower)} 个`
        : `≥ ${integerLabel(lower)} 且 < ${integerLabel(upper + 1)} 个`;
    if (upper !== null) previousMax = upper;
    return { lower, upper, label };
  });
}

export function CustomerTiersPricingSectionView({
  rows,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-tiers-pricing-heading',
}: CustomerTiersPricingSectionViewProps) {
  const ranges = tierRanges(rows);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="专版烫金 · 阶梯单价"
        basis="元 / 个"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <TableScrollArea label="专版烫金阶梯单价表">
            <div
              role="table"
              aria-label="专版烫金阶梯单价"
              className="min-w-[820px] px-4 py-3 sm:px-5"
            >
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[86px_minmax(18rem,1fr)_110px_100px_100px] items-center gap-2 border-b-2 border-foreground py-2 text-xs font-semibold tracking-wide text-muted-foreground"
                >
                  <span role="columnheader">档位</span>
                  <span role="columnheader">数量范围</span>
                  <span role="columnheader" className="text-right">
                    数量上界（含）
                  </span>
                  <span role="columnheader" className="px-1.5 text-right">
                    中号组单价
                  </span>
                  <span role="columnheader" className="px-1.5 text-right">
                    大号组单价
                  </span>
                </div>
              </div>
              <div role="rowgroup">
                {rows.map((row, index) => {
                  const range = ranges[index];
                  const lastOpenTier = row.maxQuantity.value === null;
                  return (
                    <div
                      role="row"
                      key={row.key}
                      className="grid grid-cols-[86px_minmax(18rem,1fr)_110px_100px_100px] items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
                    >
                      <span role="cell" className="font-semibold">
                        {row.name}
                      </span>
                      <span
                        role="cell"
                        className="text-xs font-semibold text-muted-foreground"
                      >
                        {range?.label ?? '待推导'}
                      </span>
                      <div role="cell">
                        <PricingNumericInput
                          {...row.maxQuantity}
                          disabled={row.maxQuantity.disabled || lastOpenTier}
                          ariaLabel={`${row.name}上界`}
                          placeholder={lastOpenTier ? '∞' : '—'}
                        />
                      </div>
                      <div role="cell" className="min-w-0">
                        <PricingNumericInput
                          {...row.middlePrice}
                          ariaLabel={`${row.name}中号组单价`}
                          step="0.0001"
                          className="w-full min-w-0 px-1.5 text-xs"
                        />
                      </div>
                      <div role="cell" className="min-w-0">
                        <PricingNumericInput
                          {...row.largePrice}
                          ariaLabel={`${row.name}大号组单价`}
                          step="0.0001"
                          className="w-full min-w-0 px-1.5 text-xs"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TableScrollArea>
        </CardContent>
      </Card>
    </section>
  );
}

function AdjustmentRows({
  rows,
}: {
  rows: readonly CustomerPricingAdjustmentRow[];
}) {
  return (
    <div className="divide-y">
      {rows.map((row) => (
        <div key={row.key} className="flex min-w-0 items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold">
              <span className="admin-wrap-anywhere">{row.label}</span>
              {row.isNew ? (
                <Badge className="h-auto rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0 text-xs font-semibold text-warning-foreground">
                  新增 · 未发布
                </Badge>
              ) : null}
            </div>
            {row.description ? (
              <p className="mt-0.5 text-xs font-medium leading-4 text-muted-foreground">
                {row.description}
              </p>
            ) : null}
          </div>
          <PricingNumericInput
            {...row.value}
            ariaLabel={`${row.label}${row.unit}`}
            step={row.unit === '元/个' ? '0.005' : undefined}
            className="w-[110px] shrink-0"
          />
          <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground">
            {row.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CustomerAddsPricingSectionView({
  paperAdjustments,
  craftAdjustments,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-adds-pricing-heading',
}: CustomerAddsPricingSectionViewProps) {
  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="专版烫金 · 加价"
        basis="元 / 个"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>专版烫金加价 · 纸张</CardSectionLabel>
          <AdjustmentRows rows={paperAdjustments} />
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>专版烫金加价 · 工艺</CardSectionLabel>
          <AdjustmentRows rows={craftAdjustments} />
        </CardContent>
      </Card>
    </section>
  );
}

export function CustomerPrintPricingSectionView({
  columns,
  rows,
  foilCells,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-print-pricing-heading',
}: CustomerPrintPricingSectionViewProps) {
  const minimumWidth = Math.max(960, 168 + columns.length * 64);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="彩印阶梯总价"
        basis="元 / 单"
        criticalBasis
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <Table label="彩印阶梯整单总价矩阵" style={{ minWidth: minimumWidth }}>
            <TableHeader>
              <TableRow className="border-b-2 border-foreground hover:bg-transparent">
                <TableHead className="w-40 px-4 text-xs font-semibold tracking-wide text-muted-foreground">
                  纸张 规格
                </TableHead>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    className="w-16 px-1 text-right text-xs font-semibold tracking-wide text-muted-foreground"
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="hover:bg-transparent">
                  <TableCell className="px-4 py-2 text-sm font-bold">
                    {row.label}
                  </TableCell>
                  {columns.map((column) => {
                    const field = matrixCell(
                      row.cells,
                      column.key,
                      `print-${row.key}-${column.key}`,
                    );
                    return (
                      <TableCell key={column.key} className="p-1">
                        <PricingNumericInput
                          {...field}
                          ariaLabel={`${row.label}${column.label}档整单总价`}
                          className="h-8 w-14 px-1.5 text-xs"
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow className="hover:bg-transparent">
                <TableCell className="px-4 py-2 text-sm font-bold">
                  <span className="block">单色烫金套餐</span>
                  <span className="mt-0.5 block text-xs font-semibold text-primary">
                    含制版费
                  </span>
                </TableCell>
                {columns.map((column) => {
                  const field = matrixCell(
                    foilCells,
                    column.key,
                    `print-foil-${column.key}`,
                  );
                  return (
                    <TableCell key={column.key} className="p-1">
                      <PricingNumericInput
                        {...field}
                        ariaLabel={`单色烫金${column.label}档含版费套餐价`}
                        className="h-8 w-14 px-1.5 text-xs"
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function cartonRanges(tiers: readonly CustomerCartonPricingTierRow[]) {
  let previousMax = 0;
  return tiers.map((tier, index) => {
    const lower = index === 0 ? 1 : previousMax + 1;
    const upper = finiteNumber(tier.maxQuantity.value);
    if (upper !== null) previousMax = upper;
    return {
      lower,
      upper,
      label:
        upper === null
          ? `≥ ${integerLabel(lower)}`
          : `${integerLabel(lower)} ~ ${integerLabel(upper)}`,
    };
  });
}

export function CustomerShipPricingSectionView({
  box,
  bag,
  carton,
  shipping,
  headingActions,
  statusContent,
  className,
  headingId = 'customer-ship-pricing-heading',
}: CustomerShipPricingSectionViewProps) {
  const ranges = cartonRanges(carton.tiers);

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 space-y-4', className)}
    >
      <PricingSectionHeading
        headingId={headingId}
        title="包装 · 纸箱耗材 · 中通快递"
        actions={headingActions}
      />
      {statusContent}

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>包装 · 元/袋</CardSectionLabel>
          <div className="divide-y">
            <ParameterRow
              label="单款入袋"
              field={bag.normalFee}
              unit="元/袋"
              step="0.05"
            />
            <ParameterRow
              label="混装"
              description="款数 ≥ 2 才可选"
              field={bag.mixedFee}
              unit="元/袋"
              step="0.05"
            />
          </div>
        </CardContent>
      </Card>

      {box ? <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>装盒 · 元/盒</CardSectionLabel>
          <div className="divide-y">{box.map((row) => <ParameterRow key={row.label} label={row.label} field={row.field} unit="元/盒" step="0.01" />)}</div>
        </CardContent>
      </Card> : null}

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <div className="px-4 pt-4 sm:px-5">
            <CardSectionLabel>
              纸箱档位 · 元/工单
            </CardSectionLabel>
          </div>
          <TableScrollArea label="纸箱费用阶梯">
            <div
              role="table"
              aria-label="纸箱费用阶梯"
              className="min-w-[680px] px-4 pt-2 sm:px-5"
            >
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[86px_minmax(16rem,1fr)_110px_110px_34px] items-center gap-2 border-b-2 border-foreground py-2 text-xs font-semibold tracking-wide text-muted-foreground"
                >
                  <span role="columnheader">档</span>
                  <span role="columnheader">范围（推导）</span>
                  <span role="columnheader" className="text-right">
                    上界(个)
                  </span>
                  <span role="columnheader" className="text-right">
                    费用(元)
                  </span>
                  <span role="columnheader" aria-label="预留操作列" />
                </div>
              </div>
              <div role="rowgroup">
                {carton.tiers.map((tier, index) => (
                  <div
                    role="row"
                    key={tier.key}
                    className="grid grid-cols-[86px_minmax(16rem,1fr)_110px_110px_34px] items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
                  >
                    <span role="cell" className="font-semibold">
                      {tier.name ?? `第${index + 1}档`}
                    </span>
                    <span
                      role="cell"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      {ranges[index]?.label ?? '待推导'}
                    </span>
                    <div role="cell">
                      <PricingNumericInput
                        {...tier.maxQuantity}
                        ariaLabel={`${tier.name ?? `第${index + 1}档`}上界`}
                      />
                    </div>
                    <div role="cell">
                      <PricingNumericInput
                        {...tier.fee}
                        ariaLabel={`${tier.name ?? `第${index + 1}档`}纸箱费用`}
                      />
                    </div>
                    <span role="cell" />
                  </div>
                ))}
              </div>
            </div>
          </TableScrollArea>
          <div className="divide-y px-4 sm:px-5">
            <ParameterRow
              label="超出末档分段数量"
              field={carton.segmentLength}
              unit="个"
            />
            <ParameterRow
              label="每段费用"
              field={carton.segmentFee}
              unit="元"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 rounded-xl py-0 shadow-none">
        <CardContent className="px-4 py-4 sm:px-5">
          <CardSectionLabel>红包单重（净重估算，不含包装）</CardSectionLabel>
          <div className="divide-y">
            {shipping.unitWeights.map((row) => (
              <ParameterRow
                key={row.key}
                label={row.label}
                field={row.value}
                unit="克/个"
                step="0.05"
              />
            ))}
            <ParameterRow
              label="快递数量上限"
              description="超出走物流，运费待定"
              field={shipping.maxQuantity}
              unit="个"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 overflow-hidden rounded-xl py-0 shadow-none">
        <CardContent className="min-w-0 p-0">
          <div className="px-4 pt-4 sm:px-5">
            <CardSectionLabel>
              中通省份档 · 首重 1kg · 计费重量向上取整
            </CardSectionLabel>
          </div>
          <TableScrollArea label="中通快递省份档">
            <div
              role="table"
              aria-label="中通快递省份档"
              className="min-w-[720px] px-4 py-2 sm:px-5"
            >
              <div role="rowgroup" className="sr-only">
                <div role="row">
                  <span role="columnheader">档位</span>
                  <span role="columnheader">省份</span>
                  <span role="columnheader">首重费用</span>
                  <span role="columnheader">续重费用</span>
                  <span role="columnheader">续重单位</span>
                </div>
              </div>
              <div role="rowgroup">
                {shipping.zones.map((zone) => (
                  <div
                    role="row"
                    key={zone.key}
                    className="grid grid-cols-[34px_minmax(19rem,1fr)_100px_100px_70px] items-center gap-2 border-b py-1.5 text-sm last:border-b-0"
                  >
                    <span role="cell" className="font-semibold">
                      {zone.name}
                    </span>
                    <span
                      role="cell"
                      className="admin-wrap-anywhere whitespace-normal text-xs font-semibold leading-5 text-muted-foreground"
                    >
                      {zone.provinces.join(' ')}
                    </span>
                    <div role="cell">
                      <PricingNumericInput
                        {...zone.firstWeightFee}
                        ariaLabel={`${zone.name}档首重费用`}
                        step="0.1"
                      />
                    </div>
                    <div role="cell">
                      <PricingNumericInput
                        {...zone.incrementFee}
                        ariaLabel={`${zone.name}档续重费用`}
                        step="0.1"
                      />
                    </div>
                    <span
                      role="cell"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      元/{decimalLabel(zone.incrementKilograms, 1)}kg
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </TableScrollArea>
        </CardContent>
      </Card>
    </section>
  );
}
