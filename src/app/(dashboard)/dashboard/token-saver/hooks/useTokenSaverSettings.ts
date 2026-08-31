"use client";

import { useState, useEffect } from "react";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../../endpoint/endpointConstants";
import { patchSetting } from "../types";

export function useTokenSaverSettings() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleCavemanLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl: { id: string; label: string; desc: string; wenyan?: boolean }) => !lvl.wenyan);

  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
    if (current?.wenyan && !isWenyanLocale) {
      setCavemanLevel("ultra");
      patchSetting({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, cavemanLevel]);

  const handleRtkEnabled = async (value: boolean) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.error("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value: boolean) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleCavemanLevel = (level: string) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value: boolean) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level: string) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  return {
    rtkEnabled, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel,
    locale, isWenyanLocale, visibleCavemanLevels,
    setRtkEnabledState, setCavemanEnabled, setCavemanLevel,
    setPonytailEnabled, setPonytailLevel,
    handleRtkEnabled, handleCavemanEnabled, handleCavemanLevel,
    handlePonytailEnabled, handlePonytailLevel,
  };
}
