"use client";

import { useTheme as useNextTheme } from "next-themes";
import { useCallback, useMemo } from "react";

type Theme = "light" | "dark" | "system";

interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

export function useTheme(): UseThemeReturn {
  const { theme: rawTheme, resolvedTheme: rawResolved, setTheme: rawSetTheme } = useNextTheme();

  const theme: Theme = (rawTheme as Theme) ?? "system";
  const resolvedTheme = rawResolved ?? "light";

  const setTheme = useCallback(
    (t: Theme) => rawSetTheme(t),
    [rawSetTheme]
  );

  const toggleTheme = useCallback(() => {
    rawSetTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [rawSetTheme, resolvedTheme]);

  const isDark = resolvedTheme === "dark";

  return useMemo(
    () => ({ theme, setTheme, toggleTheme, isDark }),
    [theme, setTheme, toggleTheme, isDark]
  );
}
