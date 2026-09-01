"use client";

import Button from "@/shared/components/Button";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem" }}>
          <h2>Something went wrong</h2>
          <Button onClick={retry}>Try again</Button>
        </div>
      </body>
    </html>
  );
}
