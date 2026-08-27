import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { customerPricingHref } from '@/lib/navigation/rule-center';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
  type NewOrderPricingRoute,
} from '@/lib/order/pricing-route';

export const metadata = {
  title: '计价方式 · 规则配置中心',
};

const ROUTE_SUMMARIES: Record<NewOrderPricingRoute, string> = {
  [OrderItemPricingRoute.STOCK_BLANK]:
    '现货规格、数量、单双面。',
  [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL]:
    '尺寸、纸张、数量、颜色、单双面。',
  [OrderItemPricingRoute.COLOR_PRINT]:
    '彩印及后道工艺。',
};

const ROUTES = NEW_ORDER_PRICING_ROUTES.map((route) => ({
  route,
  name: ORDER_PRICING_ROUTE_LABELS[route],
  summary: ROUTE_SUMMARIES[route],
}));

export default async function PricingRoutesPage() {
  await requirePermission('dict:price:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="计价方式"
        subtitle="每款单选；未自动计价时由管理员填写终价。"
        actions={
          <Link
            href={customerPricingHref('processing')}
            prefetch={false}
            className={buttonVariants()}
          >
            配置客户自动价
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        {ROUTES.map((route) => (
          <Card key={route.route}>
            <CardHeader>
              <CardTitle>{route.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                {route.summary}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
