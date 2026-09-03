import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Skills | ModelHub",
  description: "Browse ModelHub agent skills and integration guides",
};

export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
