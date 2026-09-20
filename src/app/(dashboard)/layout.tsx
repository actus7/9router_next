import type { ReactNode } from "react";
import DashboardLayout from "@/shared/components/layouts/DashboardLayout";

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
