"use client";

import { useState, useEffect } from "react";

/**
 * What the endpoint screen still needs to know.
 *
 * It used to carry four toggles — require API key, require login, whether a
 * password was set, dashboard-over-tunnel. None of them exist any more: the
 * gateway always needs a key because the key is what identifies the account,
 * login is not optional because every row has an owner, and serving the
 * dashboard on a tunnel host is `DASHBOARD_ALLOWED_HOSTS` in the environment.
 */
export function useEndpointSettings() {
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  const [baseUrl, setBaseUrl] = useState("/v1");

  // Client-side local/remote detection (UI hint only, not a security gate)
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  return { isRemoteHost, baseUrl };
}
