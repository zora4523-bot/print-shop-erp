'use client';

import { PageHeader, type PageHeaderBack } from '@/components/ui-business';
import { OrderSubmissionSuccess } from './order-form-b/OrderSubmissionSuccess';

/**
 * 单张新建工单提交成功后的整页视图。表单页头随表单卸载，这里补页面 H1（§8.3）；
 * 返回工单列表只在页头出现一次，成功卡片只保留「再建一单」。
 */
export function OrderCreatedSuccessView({ order, back }: {
  order: { orderNo: string; manualQuote: boolean; readyForProduction: boolean };
  back: PageHeaderBack;
}) {
  return (<>
    <PageHeader title="新建工单" back={back} />
    <OrderSubmissionSuccess
      orderNumber={order.orderNo}
      statusLabel={order.manualQuote ? '待工厂核价' : order.readyForProduction ? '待下发生产' : '待处理'}
      manualQuote={order.manualQuote}
      // 整页重载拿到全新的建单表单与批量列表，而不是复用当前实例的状态。
      primaryAction={{ label: '再建一单', onClick: () => window.location.assign('/orders/new') }}
    />
  </>);
}
