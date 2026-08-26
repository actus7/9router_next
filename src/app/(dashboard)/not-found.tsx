import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="flex items-center justify-center size-14 rounded-full bg-surface-2 text-text-muted">
          <SearchX className="size-7" />
        </div>
        <h2 className="text-lg font-semibold text-text-main">Page not found</h2>
        <p className="text-sm text-text-muted">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
