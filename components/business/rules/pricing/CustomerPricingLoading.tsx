import { SectionLoading } from '@/components/ui-business';
import { Skeleton } from '@/components/ui/skeleton';

export default function CustomerPricingLoading() {
  return (
    <SectionLoading label="客户计价规则">
      <div className="min-w-0 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52 max-w-full motion-reduce:animate-none" />
          <Skeleton className="h-4 w-full max-w-xl motion-reduce:animate-none" />
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl border bg-muted/50 motion-reduce:animate-none" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl border bg-muted/40 motion-reduce:animate-none" />
      </div>
    </SectionLoading>
  );
}
