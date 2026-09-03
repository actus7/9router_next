import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Console Log | ModelHub",
  description: "View server console output and runtime logs",
};

export default function ConsoleLogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
