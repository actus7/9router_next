import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings | 9Router",
  description: "Manage application settings and security",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
