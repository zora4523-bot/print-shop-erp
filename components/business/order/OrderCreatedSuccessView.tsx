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
      statusLabel={order.readyForProduction ? '待下发生产' : '待处理'}
      description={
        order.manualQuote
          ? '这张单含系统暂时无法定价的参数，工厂核价后会通知你。核价前不会安排生产。'
          : '工单已提交，资料与费用完整后进入待下发生产。可从详情查看当前进度。'
      }
      manualQuote={order.manualQuote}
      // 整页重载拿到全新的建单表单与批量列表，而不是复用当前实例的状态。
      primaryAction={{ label: '再建一单', onClick: () => window.location.assign('/orders/new') }}
    />
  </>);
}
