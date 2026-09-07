import type { ReactNode } from "react";
import { DashboardLayout } from "@/shared/components";
import { DATA_DIR_IS_EPHEMERAL } from "@/lib/dataDir";

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  // Read on the server, where the value is already known at module load. Going
  // through /api/settings would add a fetch and a loading state to every
  // dashboard page for a boolean that cannot change while the process lives.
  return <DashboardLayout storageEphemeral={DATA_DIR_IS_EPHEMERAL}>{children}</DashboardLayout>;
}
