"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ThemeProviderProps as NextThemesThemeProviderProps } from "next-themes"

type ThemeProviderProps = Omit<NextThemesThemeProviderProps, "storageKey"> & {
  children: React.ReactNode
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider storageKey="9router-theme" {...props}>
      {children}
    </NextThemesProvider>
  )
}

export type { ThemeProviderProps }
