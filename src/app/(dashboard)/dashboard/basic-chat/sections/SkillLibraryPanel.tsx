"use client";

import {
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SKILL_LIBRARIES } from "@/shared/harness/skillLibraries";
import type { useSkillLibrary } from "../hooks/useSkillLibrary";

type SkillLibraryState = ReturnType<typeof useSkillLibrary>;

const LIBRARY_ACCENTS: Record<string, string> = {
  all: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  anthropics: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  superpowers: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  vercel: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

function libraryLabel(libraryId: string | undefined): string {
  if (!libraryId) return "Comunidade";
  return SKILL_LIBRARIES.find((library) => library.id === libraryId)?.title ?? libraryId;
}

export default function SkillLibraryPanel({
  state,
  installedSkillIds,
}: {
  state: SkillLibraryState;
  installedSkillIds: Set<string>;
}) {
  const {
    open,
    setOpen,
    skills,
    query,
    setQuery,
    libraryId,
    setLibraryId,
    loading,
    installingId,
    error,
    lastInstalledId,
    activeLibrary,
    install,
    skillLibraryPageUrl,
    formatInstallCount,
  } = state;

  const showFeatured = !query.trim();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-l border-border p-0 sm:max-w-xl md:max-w-2xl"
      >
        <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/10 via-background to-background px-5 py-5">
          <div className="pointer-events-none absolute -top-10 right-0 size-40 rounded-full bg-primary/10 blur-3xl" />
          <SheetHeader className="relative p-0 text-left">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <BookOpen className="size-4" />
              </span>
              <div>
                <SheetTitle className="text-lg">Biblioteca de Skills</SheetTitle>
                <SheetDescription className="mt-0.5 text-xs">
                  Descubra e instale skills open source via skills.sh
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <label className="relative mt-4 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar: tdd, pdf, react, debugging…"
              className="h-10 border-border/80 bg-background/80 pl-9 backdrop-blur-sm"
              type="search"
              autoFocus
            />
          </label>

          <div
            className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Bibliotecas de skills"
          >
            {SKILL_LIBRARIES.map((library) => {
              const selected = library.id === libraryId;
              return (
                <button
                  key={library.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setLibraryId(library.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    selected
                      ? LIBRARY_ACCENTS[library.id] ?? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                  )}
                >
                  {library.title}
                  {library.badge ? (
                    <span className="ml-1.5 opacity-70">· {library.badge}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {activeLibrary && activeLibrary.id !== "all" ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {activeLibrary.description}
            </p>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {error ? (
            <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          {lastInstalledId ? (
            <p className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <Check className="size-3.5 shrink-0" />
              <span>
                <strong>{lastInstalledId}</strong> instalada — ative na sessão ou globalmente na
                lista.
              </span>
            </p>
          ) : null}

          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              {showFeatured ? (
                <>
                  <Star className="size-3.5 text-warning" />
                  Em destaque
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5 text-primary" />
                  Resultados
                </>
              )}
            </h3>
            {loading ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Buscando…
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {skills.length} skill{skills.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <ul className="grid gap-2.5">
            {skills.map((entry) => {
              const installed =
                installedSkillIds.has(entry.skillId) || lastInstalledId === entry.skillId;
              const busy = installingId === entry.id;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "group rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30 hover:bg-muted/30",
                    installed && "border-emerald-500/25 bg-emerald-500/5",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{entry.name}</p>
                        <Badge variant="outline" className="text-[10px]">
                          {libraryLabel(entry.libraryId)}
                        </Badge>
                        {entry.installs > 0 ? (
                          <span className="text-[10px] text-muted-foreground">
                            {formatInstallCount(entry.installs)} installs
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {entry.source}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={installed ? "secondary" : "default"}
                        disabled={installed || busy}
                        onClick={() => void install(entry)}
                        className={cn(
                          "min-w-[6.5rem]",
                          installed && "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : installed ? (
                          <>
                            <Check className="size-3.5" />
                            Instalada
                          </>
                        ) : (
                          <>
                            <Download className="size-3.5" />
                            Instalar
                          </>
                        )}
                      </Button>
                      <a
                        href={skillLibraryPageUrl(entry)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        skills.sh
                        <ExternalLink className="size-2.5" />
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {!loading && skills.length === 0 ? (
            <div className="mt-8 text-center">
              <p className="text-sm text-muted-foreground">Nenhuma skill encontrada.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tente outro termo ou mude a biblioteca.
              </p>
            </div>
          ) : null}

          <p className="mt-6 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            Skills são código de terceiros — revise o repositório antes de ativar em produção.
            Instalações entram desativadas por padrão; use o toggle global ou de sessão para
            carregá-las no prompt.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
