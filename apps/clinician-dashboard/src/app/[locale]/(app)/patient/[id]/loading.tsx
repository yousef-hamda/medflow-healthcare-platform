import { Skeleton } from "@medflow/ui";

export default function PatientLoading(): JSX.Element {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
