"use client";

import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Palette, Sun, Moon, Contrast } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { cn } from "@/lib/utils";
import AccentColorPicker from "@/shared/components/AccentColorPicker";

interface AppearanceCardProps {
  theme: string;
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export default function AppearanceCard({ theme, setTheme }: AppearanceCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Palette className="size-5" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold">{translate("Appearance")}</h3>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-text-muted">{translate("Theme")}</p>
        <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5 w-full sm:w-auto">
          {["light", "dark", "system"].map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              onClick={() => setTheme(option as "light" | "dark" | "system")}
              className={cn(
                "flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md font-medium transition-all flex-1 sm:flex-initial",
                theme === option
                  ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              {option === "light" ? <Sun className="size-4" /> : option === "dark" ? <Moon className="size-4" /> : <Contrast className="size-4" />}
              <span className="capitalize text-xs sm:text-sm">{option}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-border">
        <p className="text-sm text-text-muted">{translate("Choose the highlight color used across the dashboard")}</p>
        <AccentColorPicker />
      </div>
    </Card>
  );
}
