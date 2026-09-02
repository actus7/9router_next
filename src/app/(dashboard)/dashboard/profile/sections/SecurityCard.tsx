"use client";

import { Card } from "@/shared/components";
import { FormInput as Input } from "@/components/ui/form-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Shield } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";

interface SecurityCardProps {
  settings: Settings;
  loading: boolean;
  passwords: { current: string; new: string; confirm: string };
  setPasswords: React.Dispatch<React.SetStateAction<{ current: string; new: string; confirm: string }>>;
  passStatus: StatusMessage;
  passLoading: boolean;
  handlePasswordChange: (e: React.FormEvent) => Promise<void>;
  updateRequireLogin: (requireLogin: boolean) => Promise<void>;
}

export default function SecurityCard({
  settings, loading,
  passwords, setPasswords, passStatus, passLoading,
  handlePasswordChange, updateRequireLogin,
}: SecurityCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
          <Shield className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Security")}</h3>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">{translate("Require login")}</p>
            <p className="text-xs sm:text-sm text-text-muted">
              {translate("When ON, dashboard requires password. When OFF, access without login.")}
            </p>
          </div>
          <Switch
            checked={settings.requireLogin === true}
            onCheckedChange={() => updateRequireLogin(!settings.requireLogin)}
            disabled={loading}
          />
        </div>
        {settings.requireLogin === true && (
          <form onSubmit={handlePasswordChange} className="flex flex-col gap-4 pt-4 border-t border-border/50">
            {settings.hasPassword && (
              <div className="flex flex-col gap-2">
                <Label className="text-xs sm:text-sm">{translate("Current Password")}</Label>
                <Input
                  type="password"
                  placeholder={translate("Enter current password") || ""}
                  value={passwords.current}
                  onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                  required
                />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label className="text-xs sm:text-sm">{translate("New Password")}</Label>
                <Input
                  type="password"
                  placeholder={translate("Enter new password") || ""}
                  value={passwords.new}
                  onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs sm:text-sm">{translate("Confirm New Password")}</Label>
                <Input
                  type="password"
                  placeholder={translate("Confirm new password") || ""}
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                  required
                />
              </div>
            </div>

            {passStatus.message && (
              <p className={`text-xs sm:text-sm ${passStatus.type === "error" ? "text-destructive" : "text-success"}`}>
                {passStatus.message}
              </p>
            )}

            <div className="pt-2">
              <Button type="submit" variant="primary" loading={passLoading} className="w-full sm:w-auto">
                {settings.hasPassword ? translate("Update Password") : translate("Set Password")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
