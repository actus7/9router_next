"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/shared/components/Loading";
import { translate } from "@/i18n/runtime";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState("password");
  const [ssoType, setSsoType] = useState("oidc");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState(translate("Sign in with OIDC"));
  const [samlConfigured, setSamlConfigured] = useState(false);
  const [samlLoginLabel, setSamlLoginLabel] = useState(translate("Sign in with SAML SSO"));
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            router.replace("/dashboard");
            return;
          }
          setHasPassword(!!data.hasPassword);
          setAuthMode(data.authMode || "password");
          setSsoType(data.ssoType || "oidc");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || translate("Sign in with OIDC"));
          setSamlConfigured(data.samlConfigured === true);
          setSamlLoginLabel(data.samlLoginLabel || translate("Sign in with SAML SSO"));
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch  {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mustChangePassword) {
          setMustChange(true);
          return;
        }
        router.replace("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || translate("Invalid password") || "");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch  {
      setError(translate("An error occurred. Please try again.") || "");
    } finally {
      setLoading(false);
    }
  };

  // Force a new password before entering the dashboard (default + remote).
  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (res.ok) {
        router.replace("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || translate("Failed to set password") || "");
      }
    } catch  {
      setError(translate("An error occurred. Please try again.") || "");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    // This endpoint delegates to an identity provider and requires a document navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/auth/oidc/start";
  };

  const handleSamlLogin = () => {
    // This endpoint delegates to an identity provider and requires a document navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/auth/saml/start";
  };

  const isSsoEnabled = ["sso", "oidc", "saml", "both"].includes(authMode);
  const activeSsoType = ssoType || (authMode === "saml" ? "saml" : "oidc");

  const samlAvailable = isSsoEnabled && activeSsoType === "saml" && samlConfigured;
  const oidcAvailable = isSsoEnabled && activeSsoType === "oidc" && oidcConfigured;
  const ssoAvailable = samlAvailable || oidcAvailable;

  const passwordAvailable = authMode === "password" || authMode === "both" || !ssoAvailable;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <Spinner size="lg" />
          <p className="text-text-muted mt-4">{translate("Loading...")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      {/* Faint grid background */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">ModelHub</h1>
          <p className="text-text-muted">
            {samlAvailable
              ? translate("Sign in with SAML 2.0 Single Sign-On")
              : oidcAvailable
              ? translate("Sign in with your OIDC provider to access the dashboard")
              : translate("Enter your password to access the dashboard")}
          </p>
        </div>

        <Card>
          {mustChange ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                {translate("Set a new password before accessing the dashboard remotely.")}
              </p>
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">{translate("New Password")}</Label>
                <Input
                  type="password"
                  placeholder={translate("Enter new password") || ""}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                {translate("Set Password")}
              </Button>
            </form>
          ) : (
          <div className="flex flex-col gap-4">
            {samlAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleSamlLogin}>
                {samlLoginLabel}
              </Button>
            )}

            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {ssoAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {isSsoEnabled && !ssoAvailable && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    {activeSsoType === "saml" ? "SAML SSO" : "OIDC"}{" "}{translate("login is enabled, but the configuration is incomplete. Password login is still available for recovery.")}
                  </p>
                )}

                {authMode === "both" && ssoAvailable && (
                  <p className="text-xs text-text-muted text-center">
                    {translate("Password login and")} {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} {translate("are enabled.")}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">{translate("Password")}</Label>
                  <Input
                    type="password"
                    placeholder={translate("Enter password") || ""}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus={!oidcAvailable}
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  {retryAfter > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {translate("Blocked. Try again in")} <span className="font-mono">{retryAfter}s</span>.
                    </p>
                  )}
                  {resetHint && (
                    <p className="text-xs text-text-muted">
                      {translate("Forgot your password? Open the CLI")} <code className="bg-sidebar px-1 rounded">modelhub</code> {translate("on the host →")} <b>{translate("Settings")}</b> → <b>{translate("Reset Password to Default")}</b>.
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={loading}
                  disabled={retryAfter > 0}
                >
                  {retryAfter > 0 ? `${translate("Please wait")} ${retryAfter}s` : translate("Sign In")}
                </Button>

                <p className="text-xs text-center text-text-muted mt-2">
                  {translate("The default password is")} <code className="bg-sidebar px-1 rounded">123456</code>
                </p>
                {hasPassword === false && (
                  <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                    {translate("Security risk: no password set. You will be asked to set one when logging in remotely.")}
                  </p>
                )}
              </form>
            ) : (
              error && <p className="text-xs text-red-500">{error}</p>
            )}
          </div>
          )}
        </Card>
      </div>
    </div>
  );
}
