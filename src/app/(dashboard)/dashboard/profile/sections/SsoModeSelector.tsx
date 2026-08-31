"use client";

import { Button } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";
import { cn } from "@/lib/utils";

interface SsoModeSelectorProps {
  ssoTypeTab: string;
  setSsoTypeTab: React.Dispatch<React.SetStateAction<string>>;
  authMode: string;
  updateOidcForm: (field: string, value: string) => void;
  loading: boolean;
  oidcLoading: boolean;
  samlLoading: boolean;
}

export default function SsoModeSelector({
  ssoTypeTab,
  setSsoTypeTab,
  authMode,
  updateOidcForm,
  loading,
  oidcLoading,
  samlLoading,
}: SsoModeSelectorProps) {
  return (
    <>
      {/* SSO Protocol Switcher Tabs */}
      <div className="flex flex-col gap-2">
        <Label className="sm:text-base">{translate("SSO Protocol")}</Label>
        <div className="flex p-1 rounded-lg bg-black/5 dark:bg-white/5 border border-border">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setSsoTypeTab("saml")}
            className={cn(
              "flex-1 py-1.5 px-3 rounded-md font-medium text-xs sm:text-sm transition-all text-center",
              ssoTypeTab === "saml"
                ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                : "text-text-muted hover:text-text-main"
            )}
          >
            SAML 2.0
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setSsoTypeTab("oidc")}
            className={cn(
              "flex-1 py-1.5 px-3 rounded-md font-medium text-xs sm:text-sm transition-all text-center",
              ssoTypeTab === "oidc"
                ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                : "text-text-muted hover:text-text-main"
            )}
          >
            OIDC
          </Button>
        </div>
      </div>

      {/* Auth Mode selection */}
      <div className="flex flex-col gap-2">
        <Label className="sm:text-base">{translate("Auth Mode")}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            {
              value: "password",
              title: translate("Password only") || "Password only",
              desc: translate("Keep legacy password login.") || "Keep legacy password login.",
            },
            {
              value: "sso",
              title: `${translate("Only") || "Only"} ${ssoTypeTab === "saml" ? "SAML" : "OIDC"}`,
              desc: translate("Require SSO for dashboard access.") || "Require SSO for dashboard access.",
            },
            {
              value: "both",
              title: translate("Both") || "Both",
              desc: translate("Allow password or SSO login.") || "Allow password or SSO login.",
            },
          ].map((option) => {
            const active =
              option.value === "password"
                ? authMode === "password"
                : option.value === "sso"
                  ? authMode === "sso" || authMode === "saml" || authMode === "oidc"
                  : authMode === "both";
            return (
              <Button
                key={option.value}
                variant="outline"
                type="button"
                onClick={() => updateOidcForm("authMode", option.value)}
                className={cn(
                  "text-left rounded-lg border p-3 transition-colors h-auto",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border bg-bg hover:bg-surface-2/50"
                )}
                disabled={loading || oidcLoading || samlLoading}
              >
                <div className="text-left">
                  <p className="font-medium text-sm sm:text-base">{option.title}</p>
                  <p className="text-xs sm:text-sm text-text-muted mt-1">{option.desc}</p>
                </div>
              </Button>
            );
          })}
        </div>
      </div>
    </>
  );
}
