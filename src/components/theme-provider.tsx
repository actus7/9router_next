"use client"

import { useEffect, useCallback } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"

type Theme = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

interface ThemeState {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      resolvedTheme: "dark",
      setTheme: (theme: Theme) => {
        const resolved = resolveTheme(theme)
        set({ theme, resolvedTheme: resolved })
      },
      toggleTheme: () => {
        const current = get().resolvedTheme
        const next = current === "dark" ? "light" : "dark"
        set({ theme: next, resolvedTheme: next })
      },
    }),
    {
      name: "9router-theme",
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.resolvedTheme = resolveTheme(state.theme)
        }
      },
    }
  )
)

function applyTheme(resolvedTheme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  root.style.colorScheme = resolvedTheme
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  /** Compatibility prop – ignored (always uses class) */
  attribute?: string
  /** Compatibility prop – system detection is always enabled */
  enableSystem?: boolean
  /** Compatibility prop – transitions are not disabled */
  disableTransitionOnChange?: boolean
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: ThemeProviderProps) {
  const { theme, resolvedTheme, setTheme } = useThemeStore()

  // Apply theme class to <html>
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return

    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      const newResolved = getSystemTheme()
      useThemeStore.setState({ resolvedTheme: newResolved })
    }

    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [theme])

  // Initialize on mount
  useEffect(() => {
    const stored = useThemeStore.getState().theme
    if (!stored) {
      setTheme(defaultTheme)
    } else {
      const resolved = resolveTheme(stored)
      applyTheme(resolved)
    }
  }, [defaultTheme, setTheme])

  return <>{children}</>
}


export type { Theme, ResolvedTheme }
