"use client";

import { useEffect, useState } from "react";

interface CooldownState {
  isCooldown: boolean;
  modelLockUntil: string | null;
  effectiveStatus: string | undefined;
}

// Use useState + useEffect for impure Date.now() to avoid calling during render
export function useConnectionCooldown(connection: { testStatus?: string; [key: string]: unknown }): CooldownState {
  const [isCooldown, setIsCooldown] = useState<boolean>(false);

  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter((v): v is string => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter((v): v is string => typeof v === "string" && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil, connection]);

  // Cooldown expired → treat as active
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown) ? "active" : connection.testStatus;

  return { isCooldown, modelLockUntil, effectiveStatus };
}
