import { Spinner } from "@/shared/components/Loading";

export default function TokenSaverLoading() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm text-text-muted">Loading token saver settings...</p>
      </div>
    </div>
  );
}
