import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), register: vi.fn(), normalize: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/order/shipment-registration', () => ({ registerShipment: mocks.register, normalizeShipmentImage: mocks.normalize, SHIPMENT_IMAGE_LIMIT: 524288 }));
vi.mock('@/lib/order', () => ({ OrderInvariantError: class extends Error {} }));
vi.mock('@/lib/order/admin-workflow', () => ({ AdminOrderWorkflowError: class extends Error {} }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { registerShipmentAction } from '../shipment-registration';
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ id: 'admin', role: 'ADMIN' }); });
function form() { const form = new FormData(); Object.entries({ orderId: 'o1', shipmentId: 's1', expectedVersion: '0', expectedRevision: '1', expectedEditVersion: '1', expectedWorkOrderVersion: '1', expectedPriceRevision: '1', idempotencyKey: '5d5cd706-2c98-40ce-b260-535cd76ebc90', trackingNo: 'ZTO123', carrierCode: 'ZTO', carrierName: '', confirm: 'true' }).forEach(([k,v]) => form.set(k,v)); return form; }
it('requires shipping permission before accepting a payload', async () => { mocks.permission.mockRejectedValue(new Error('forbidden')); await expect(registerShipmentAction(form())).rejects.toThrow('forbidden'); expect(mocks.register).not.toHaveBeenCalled(); });
it('rejects invalid input and oversized images without mutation', async () => { const invalid = form(); invalid.set('trackingNo', ''); expect((await registerShipmentAction(invalid)).ok).toBe(false); const large = form(); large.set('photo', new File([new Uint8Array(600000)], 'large.jpg')); expect((await registerShipmentAction(large)).ok).toBe(false); expect(mocks.register).not.toHaveBeenCalled(); });
it('refreshes the order and billing views after success', async () => { mocks.register.mockResolvedValue({ completed: true }); expect((await registerShipmentAction(form())).ok).toBe(true); expect(mocks.permission).toHaveBeenCalledWith('order:ship'); expect(mocks.revalidate).toHaveBeenCalledWith('/owner/agent-bills'); });
it('does not expose infrastructure errors', async () => { mocks.register.mockRejectedValue(new Error('secret database connection')); const result = await registerShipmentAction(form()); expect(result.ok).toBe(false); expect(result.message).not.toContain('secret'); });
