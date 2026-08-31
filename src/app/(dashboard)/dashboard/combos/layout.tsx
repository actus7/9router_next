import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Combos | ModelHub",
  description: "Manage model combos with fallback support",
};

export default function CombosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
