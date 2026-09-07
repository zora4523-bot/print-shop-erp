import { Badge } from '@/components/ui/badge';
import { TableScrollArea } from '@/components/ui-business';
import { resolveOrderItemFoilSides } from '@/lib/order/pricing-route';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

type SnapshotItem = {
  id: string;
  sequence: number | null;
  name: string;
  quantity: number | null;
  specification: string | null;
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  isDoubleSided: boolean;
};

type DiffRow = {
  key: string;
  field: string;
  before: string;
  after: string;
  pricingImpact: '不影响计价' | '需要重新计价';
  productionImpact: string;
};

type DiffGroup = {
  key: string;
  title: string;
  operation: '修改' | '新增';
  rows: DiffRow[];
};

const FIELD_DEFINITIONS = [
  {
    key: 'name',
    label: '款式名称',
    pricingImpact: '不影响计价',
    productionImpact: '同步任务展示名称',
  },
  {
    key: 'quantity',
    label: '数量',
    pricingImpact: '需要重新计价',
    productionImpact: '校验已开工记录并同步任务数量',
  },
  {
    key: 'specification',
    label: '规格',
    pricingImpact: '需要重新计价',
    productionImpact: '同步生产规格',
  },
  {
    key: 'frontFoilColors',
    label: '正面烫金颜色',
    pricingImpact: '需要重新计价',
    productionImpact: '同步正面烫金要求',
  },
  {
    key: 'backFoilColors',
    label: '反面烫金颜色',
    pricingImpact: '需要重新计价',
    productionImpact: '同步反面烫金要求',
  },
] as const;

function readSnapshotItems(value: unknown): SnapshotItem[] {
  const items = (value as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string') return [];
    const foilColors = stringArray(item.foilColors);
    const isDoubleSided = item.isDoubleSided === true;
    const foilSides = resolveOrderItemFoilSides({
      frontFoilColors: stringArray(item.frontFoilColors),
      backFoilColors: stringArray(item.backFoilColors),
      foilColors,
      isDoubleSided,
    });
    return [
      {
        id: item.id,
        sequence:
          typeof item.sequence === 'number' && Number.isFinite(item.sequence)
            ? item.sequence
            : null,
        name: typeof item.name === 'string' ? item.name : '未命名款式',
        quantity:
          typeof item.quantity === 'number' && Number.isFinite(item.quantity)
            ? item.quantity
            : null,
        specification:
          typeof item.specification === 'string' ? item.specification : null,
        ...foilSides,
        foilColors,
        isDoubleSided,
      },
    ];
  });
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function foilSidesAfterChange(
  change: Record<string, unknown>,
  source: SnapshotItem | undefined,
): { frontFoilColors: string[]; backFoilColors: string[] } {
  if (hasOwn(change, 'frontFoilColors') || hasOwn(change, 'backFoilColors')) {
    return {
      frontFoilColors: hasOwn(change, 'frontFoilColors')
        ? stringArray(change.frontFoilColors)
        : (source?.frontFoilColors ?? []),
      backFoilColors: hasOwn(change, 'backFoilColors')
        ? stringArray(change.backFoilColors)
        : (source?.backFoilColors ?? []),
    };
  }
  if (hasOwn(change, 'foilColors')) {
    return resolveOrderItemFoilSides({
      foilColors: stringArray(change.foilColors),
      isDoubleSided: source?.isDoubleSided ?? false,
    });
  }
  return {
    frontFoilColors: source?.frontFoilColors ?? [],
    backFoilColors: source?.backFoilColors ?? [],
  };
}

function comparable(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(
      [...new Set(value.filter((item) => typeof item === 'string'))].sort(),
    );
  }
  return value === undefined || value === '' ? 'null' : JSON.stringify(value);
}

function displayValue(field: string, value: unknown): string {
  if (field === 'frontFoilColors' || field === 'backFoilColors') {
    const colors = Array.isArray(value)
      ? value.filter((color): color is string => typeof color === 'string')
      : [];
    return colors.length > 0 ? colors.join('、') : '无';
  }
  if (field === 'quantity' && typeof value === 'number') {
    return value.toLocaleString('zh-CN');
  }
  if (value === null || value === undefined || value === '') return '空';
  const text = String(value);
  return field === 'name' || field === 'specification'
    ? externalPriceBusinessText(text)
    : text;
}

function buildDiffGroups(
  beforeSnapshot: unknown,
  proposedChanges: unknown,
): DiffGroup[] {
  const snapshotItems = readSnapshotItems(beforeSnapshot);
  const itemById = new Map(snapshotItems.map((item) => [item.id, item]));
  const changes = (proposedChanges as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(changes)) return [];

  return changes.flatMap<DiffGroup>((raw, changeIndex) => {
    if (!raw || typeof raw !== 'object') return [];
    const change = raw as Record<string, unknown>;

    if (change.operation === 'UPDATE' && typeof change.itemId === 'string') {
      const before = itemById.get(change.itemId);
      if (!before) {
        return [
          {
            key: `update-${changeIndex}`,
            title: `原款式 ${change.itemId}`,
            operation: '修改' as const,
            rows: [
              {
                key: `missing-${changeIndex}`,
                field: '数据校验',
                before: '申请中缺少该款式',
                after: '无法展示',
                pricingImpact: '不影响计价' as const,
                productionImpact: '审核前需重新提交申请',
              },
            ],
          },
        ];
      }

      const beforeRecord: Record<string, unknown> = {
        name: before.name,
        quantity: before.quantity,
        specification: before.specification,
        frontFoilColors: before.frontFoilColors,
        backFoilColors: before.backFoilColors,
      };
      const afterRecord: Record<string, unknown> = { ...change };
      if (
        hasOwn(change, 'frontFoilColors') ||
        hasOwn(change, 'backFoilColors') ||
        hasOwn(change, 'foilColors')
      ) {
        Object.assign(afterRecord, foilSidesAfterChange(change, before));
      }
      const rows = FIELD_DEFINITIONS.flatMap<DiffRow>((definition) => {
        if (!hasOwn(afterRecord, definition.key)) return [];
        const previous = beforeRecord[definition.key];
        const next = afterRecord[definition.key];
        if (comparable(previous) === comparable(next)) return [];
        return [
          {
            key: `${changeIndex}-${definition.key}`,
            field: definition.label,
            before: displayValue(definition.key, previous),
            after: displayValue(definition.key, next),
            pricingImpact: definition.pricingImpact,
            productionImpact: definition.productionImpact,
          },
        ];
      });

      if (rows.length === 0) return [];
      const sequence = before.sequence === null ? '' : `#${before.sequence} · `;
      return [
        {
          key: `update-${changeIndex}`,
          title: `${sequence}${externalPriceBusinessText(before.name)}`,
          operation: '修改' as const,
          rows,
        },
      ];
    }

    if (change.operation === 'ADD') {
      const template =
        typeof change.templateItemId === 'string'
          ? itemById.get(change.templateItemId)
          : undefined;
      const afterRecord: Record<string, unknown> = {
        ...change,
        ...foilSidesAfterChange(change, template),
      };
      const rows = FIELD_DEFINITIONS.flatMap<DiffRow>((definition) => {
        if (!hasOwn(afterRecord, definition.key)) return [];
        return [
          {
            key: `${changeIndex}-${definition.key}`,
            field: definition.label,
            before: '—（新增）',
            after: displayValue(definition.key, afterRecord[definition.key]),
            pricingImpact: '需要重新计价' as const,
            productionImpact:
              definition.key === 'quantity'
                ? '创建对应待生产任务'
                : definition.productionImpact,
          },
        ];
      });
      const templateLabel = template
        ? `参考 #${template.sequence ?? '—'} · ${externalPriceBusinessText(template.name)}`
        : '参考款式无法识别';
      return [
        {
          key: `add-${changeIndex}`,
          title: `新增 · ${displayValue('name', change.name)}（${templateLabel}）`,
          operation: '新增' as const,
          rows,
        },
      ];
    }

    return [];
  });
}

export function OrderChangeFieldDiff({
  beforeSnapshot,
  proposedChanges,
}: {
  beforeSnapshot: unknown;
  proposedChanges: unknown;
}) {
  const groups = buildDiffGroups(beforeSnapshot, proposedChanges);
  if (proposedChanges && typeof proposedChanges === 'object' && 'promisedDate' in proposedChanges &&
      (proposedChanges.promisedDate === null || typeof proposedChanges.promisedDate === 'string')) {
    const before = beforeSnapshot && typeof beforeSnapshot === 'object' && 'promisedDate' in beforeSnapshot && typeof beforeSnapshot.promisedDate === 'string'
      ? beforeSnapshot.promisedDate : '未设置';
    groups.unshift({ key: 'promised-date', title: '承诺交期', operation: '修改', rows: [{ key: 'promised-date', field: '承诺交期', before, after: proposedChanges.promisedDate ?? '未设置', pricingImpact: '不影响计价', productionImpact: '更新交期，已产数量保留' }] });
  }

  if (groups.length === 0) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground"
      >
        申请中没有可识别的逐字段差异，请勿仅凭摘要批准；需要提交人重新创建申请。
      </p>
    );
  }

  return (
    <section
      data-slot="order-change-field-diff"
      aria-label="申请字段差异"
      className="mt-3 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">逐字段差异</h3>
        <p className="text-xs text-muted-foreground">
          计价以审批预览为准；批准时会再次检查工单状态。
        </p>
      </div>
      <ol className="space-y-3">
        {groups.map((group) => (
          <li key={group.key} className="min-w-0 rounded-lg border bg-muted/10">
            <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2">
              <Badge variant={group.operation === '新增' ? 'secondary' : 'outline'}>
                {group.operation}
              </Badge>
              <h4 className="admin-wrap-anywhere min-w-0 text-sm font-medium">
                {group.title}
              </h4>
            </div>
            <TableScrollArea label={`${group.title}字段差异`}>
              <table className="w-full min-w-[46rem] text-xs">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">字段</th>
                    <th className="px-3 py-2 text-left font-medium">修改前</th>
                    <th className="px-3 py-2 text-center font-medium" aria-label="变为" />
                    <th className="px-3 py-2 text-left font-medium">修改后</th>
                    <th className="px-3 py-2 text-left font-medium">计价影响</th>
                    <th className="px-3 py-2 text-left font-medium">生产影响</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {group.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {row.field}
                      </th>
                      <td className="admin-wrap-anywhere max-w-52 px-3 py-2 text-muted-foreground">
                        {row.before}
                      </td>
                      <td className="px-1 py-2 text-center text-muted-foreground" aria-hidden>
                        →
                      </td>
                      <td className="admin-wrap-anywhere max-w-52 px-3 py-2 font-medium">
                        {row.after}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.pricingImpact === '需要重新计价'
                              ? 'text-warning-foreground'
                              : 'text-muted-foreground'
                          }
                        >
                          {row.pricingImpact}
                        </span>
                      </td>
                      <td className="admin-wrap-anywhere px-3 py-2 text-muted-foreground">
                        {row.productionImpact}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollArea>
          </li>
        ))}
      </ol>
    </section>
  );
}
