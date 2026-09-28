import { Skeleton, TableSkeleton, StatGrid } from "@/components/ui";

/** Route-level loading state: header line, four stat placeholders, one table. Keeps layout stable while data loads. */
export default function Loading() {
  return (
    <div aria-busy aria-live="polite">
      <div className="mb-5">
        <Skeleton lines={2} className="max-w-sm" />
      </div>
      <StatGrid cols={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="statcard">
            <Skeleton lines={2} />
          </div>
        ))}
      </StatGrid>
      <div className="card mt-4 p-4">
        <TableSkeleton rows={6} cols={5} />
      </div>
    </div>
  );
}
