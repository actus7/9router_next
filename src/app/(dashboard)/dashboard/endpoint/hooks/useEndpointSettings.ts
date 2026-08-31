"use client";

import { useState, useEffect } from "react";

export function useEndpointSettings() {
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
  const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  const [baseUrl, setBaseUrl] = useState("/v1");

  // Client-side local/remote detection (UI hint only, not a security gate)
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setRequireApiKey(data.requireApiKey || false);
        setRequireLogin(data.requireLogin !== false);
        setHasPassword(data.hasPassword || false);
        setTunnelDashboardAccess(data.tunnelDashboardAccess || false);
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  };

  const handleTunnelDashboardAccess = async (value: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tunnelDashboardAccess: value }),
      });
      if (res.ok) setTunnelDashboardAccess(value);
    } catch (error) {
      console.error("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (res.ok) setRequireApiKey(value);
    } catch (error) {
      console.error("Error updating requireApiKey:", error);
    }
  };

  return {
    requireApiKey, requireLogin, hasPassword,
    tunnelDashboardAccess, isRemoteHost, baseUrl,
    loadSettings, handleTunnelDashboardAccess, handleRequireApiKey,
  };
}
