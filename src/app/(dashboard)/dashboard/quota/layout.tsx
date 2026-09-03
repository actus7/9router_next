import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quota | ModelHub",
  description: "View and manage provider usage limits",
};

export default function QuotaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
