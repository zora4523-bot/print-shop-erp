'use server';

import type { RuleCenterPriceVersionSummary } from '@/components/business/rules/RuleCenterWorkspaceBar';
import { CustomerPriceBookPurpose } from '@/generated/prisma/enums';
import { hasPermission } from '@/lib/auth/permissions-dict';
import { getSession } from '@/lib/auth/session';
import { listCustomerPriceBookVersionsAndDrafts } from '@/lib/price/customer-price-book-admin';

export async function getRuleCenterPriceVersionSummary(): Promise<RuleCenterPriceVersionSummary> {
  try {
    const session = await getSession();
    if (
      !session ||
      !hasPermission('dict:price:manage', session.user.role)
    ) {
      return { state: 'hidden', streams: [] };
    }

    const versions = await listCustomerPriceBookVersionsAndDrafts();
    const definitions = [
      {
        key: 'processing' as const,
        label: '加工费' as const,
        purpose: CustomerPriceBookPurpose.PROCESSING,
      },
      {
        key: 'logistics' as const,
        label: '物流费' as const,
        purpose: CustomerPriceBookPurpose.LOGISTICS,
      },
    ];

    return {
      state: 'ready',
      streams: definitions.map((definition) => {
        const scoped = versions.filter(
          (version) => version.purpose === definition.purpose,
        );
        const current = scoped.find((version) => version.status === 'CURRENT');
        const draft = scoped.find((version) => version.status === 'DRAFT');
        const scheduled = scoped.find(
          (version) => version.status === 'SCHEDULED',
        );

        return {
          key: definition.key,
          label: definition.label,
          currentVersion: current?.version ?? null,
          draftVersion: draft?.version ?? null,
          draftId: draft?.id ?? null,
          scheduledVersion: scheduled?.version ?? null,
        };
      }),
    };
  } catch {
    // 版本状态是辅助信息：读取失败时只让工作区条降级，不阻塞价格页。
    return { state: 'unavailable', streams: [] };
  }
}
