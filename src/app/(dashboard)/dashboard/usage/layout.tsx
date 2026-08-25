import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Usage & Analytics | 9Router",
  description: "View API usage statistics and analytics",
};

export default function UsageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
