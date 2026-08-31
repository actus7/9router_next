"use client";

import { Button } from "@/shared/components";
import { LogOut } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { APP_CONFIG } from "@/shared/constants/config";

interface AccountActionsProps {
  handleLogout: () => Promise<void>;
}

export default function AccountActions({ handleLogout }: AccountActionsProps) {
  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="outline"
          fullWidth
          icon={<LogOut className="size-4" />}
          onClick={handleLogout}
        >
          {translate("Logout")}
        </Button>
      </div>

      <div className="text-center text-xs sm:text-sm text-text-muted py-4">
        <p>{APP_CONFIG.name} v{APP_CONFIG.version}</p>
        <p className="mt-1">{translate("Local Mode - All data stored on your machine")}</p>
      </div>
    </>
  );
}
