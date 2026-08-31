import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Usage & Analytics | ModelHub",
  description: "View API usage statistics and analytics",
};

export default function UsageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
