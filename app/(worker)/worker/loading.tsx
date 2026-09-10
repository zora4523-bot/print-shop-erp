import { SectionLoading } from '@/components/ui-business';
import { Skeleton } from '@/components/ui/skeleton';

export default function WorkerLoading() {
  return (
    <SectionLoading label="师傅工作台">
      <div className="space-y-4">
        <Skeleton className="h-7 w-32 motion-reduce:animate-none" />
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-28 rounded-xl border bg-card motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </SectionLoading>
  );
}
