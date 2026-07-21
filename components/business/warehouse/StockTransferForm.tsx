'use client';

import { useActionState, useCallback, useMemo, useState } from 'react';
import type { MutationResult } from '@/lib/admin/action-helpers';
import type { WarehouseLocationOption } from '@/lib/warehouse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type MaterialOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
};

type LocationStock = {
  materialId: string;
  locationId: string;
  currentStock: string;
};

type Props = {
  action: (
    prev: MutationResult | null,
    formData: FormData,
  ) => Promise<MutationResult>;
  materials: MaterialOption[];
  locations: WarehouseLocationOption[];
  locationStocks: LocationStock[];
  initialIdempotencyKey: string;
};

const selectClass =
  'flex min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export function StockTransferForm({
  action,
  materials,
  locations,
  locationStocks,
  initialIdempotencyKey,
}: Props) {
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const submitTransfer = useCallback(
    async (prev: MutationResult | null, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.status === 'success') {
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [action],
  );
  const [state, formAction, pending] = useActionState<MutationResult | null, FormData>(
    submitTransfer,
    null,
  );
  const [materialId, setMaterialId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const errors = state?.status === 'invalid' ? state.fieldErrors : {};
  const error = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success' ? state.message : null;
  const selectedMaterial = materials.find((material) => material.id === materialId);
  const available = useMemo(
    () =>
      locationStocks.find(
        (stock) =>
          stock.materialId === materialId && stock.locationId === sourceLocationId,
      )?.currentStock ?? '0.00',
    [locationStocks, materialId, sourceLocationId],
  );

  const prerequisitesMissing = materials.length === 0 || locations.length < 2;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Field id="transfer-material" label="物料" error={errors.materialId?.[0]}>
          <select
            id="transfer-material"
            name="materialId"
            className={selectClass}
            value={materialId}
            onChange={(event) => setMaterialId(event.target.value)}
            disabled={pending || materials.length === 0}
          >
            <option value="">请选择物料</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.code} · {material.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="transfer-source" label="来源库位" error={errors.sourceLocationId?.[0]}>
          <select
            id="transfer-source"
            name="sourceLocationId"
            className={selectClass}
            value={sourceLocationId}
            onChange={(event) => setSourceLocationId(event.target.value)}
            disabled={pending || locations.length === 0}
          >
            <option value="">请选择来源库位</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.warehouseName} / {location.name}
              </option>
            ))}
          </select>
          {materialId && sourceLocationId ? (
            <p className="text-xs text-muted-foreground">
              可用 {available} {selectedMaterial?.unit ?? ''}
            </p>
          ) : null}
        </Field>
        <Field id="transfer-destination" label="目标库位" error={errors.destinationLocationId?.[0]}>
          <select
            id="transfer-destination"
            name="destinationLocationId"
            className={selectClass}
            value={destinationLocationId}
            onChange={(event) => setDestinationLocationId(event.target.value)}
            disabled={pending || locations.length === 0}
          >
            <option value="">请选择目标库位</option>
            {locations.map((location) => (
              <option
                key={location.id}
                value={location.id}
                disabled={location.id === sourceLocationId}
              >
                {location.warehouseName} / {location.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          id="transfer-quantity"
          label={`调拨数量${selectedMaterial ? `（${selectedMaterial.unit}）` : ''}`}
          error={errors.quantity?.[0]}
        >
          <Input id="transfer-quantity" name="quantity" inputMode="decimal" disabled={pending} />
        </Field>
        <Field id="transfer-remark" label="备注（选填）" error={errors.remark?.[0]}>
          <Input id="transfer-remark" name="remark" disabled={pending} />
        </Field>
      </div>

      {prerequisitesMissing ? (
        <p role="alert" className="text-sm text-warning-foreground">
          调拨至少需要一个启用物料和两个启用库位。
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {success ? <p role="status" className="text-sm text-success">✓ {success}</p> : null}
      <Button type="submit" disabled={pending || prerequisitesMissing}>
        {pending ? '调拨中…' : '确认调拨'}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
