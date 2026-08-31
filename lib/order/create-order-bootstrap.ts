import { db } from '../db';
import {
  readExternalCreateOrderOptions,
  type ExternalCreateOrderOptions,
} from './create-order-options';
import {
  readExternalCreateOrderPriceSnapshot,
  type ExternalCreateOrderPriceSnapshot,
} from './create-order-price-snapshot';

export type ExternalCreateOrderBootstrap = {
  options: ExternalCreateOrderOptions;
  priceSnapshot: ExternalCreateOrderPriceSnapshot;
};

/**
 * Read the selectable catalog and both price-book identities under one
 * transaction and one shared snapshot lock. This prevents the page from
 * combining options observed before a price-book publication with versions
 * observed after it.
 */
export async function loadExternalCreateOrderBootstrap(
  now: Date = new Date(),
): Promise<ExternalCreateOrderBootstrap> {
  return db.$transaction(async (tx) => {
    const priceSnapshot = await readExternalCreateOrderPriceSnapshot(tx, {
      now,
    });
    const options = await readExternalCreateOrderOptions(tx, {
      snapshotLockHeld: true,
    });
    return { options, priceSnapshot };
  });
}
