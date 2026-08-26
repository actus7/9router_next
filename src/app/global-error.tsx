"use client";

import Button from "@/shared/components/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
          <h2>Something went wrong</h2>
          <Button onClick={reset}>Try again</Button>
        </div>
      </body>
    </html>
  );
}
