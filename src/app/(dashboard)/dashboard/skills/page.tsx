import { Card } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import {
  SKILLS,
  SKILLS_REPO_URL,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";
import { CopyButton } from "./CopyButton";
import { ExternalLink, ImageIcon, Languages, MessageSquare, Mic, Network, ScatterChart, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  endpoint?: string;
  isEntry?: boolean;
}

// Skill.icon stores a legacy Material Symbols ligature name; map it to the
// lucide-react icon the rest of the app renders instead of showing raw text.
const SKILL_ICON_MAP: Record<string, LucideIcon> = {
  hub: Network,
  chat: MessageSquare,
  image: ImageIcon,
  record_voice_over: Mic,
  mic: Mic,
  scatter_plot: ScatterChart,
  search: Search,
  language: Languages,
};

function SkillRow({ skill }: { skill: Skill }) {
  const url = getSkillRawUrl(skill.id);
  const Icon = SKILL_ICON_MAP[skill.icon] || Network;
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-[14px] border shadow-[var(--shadow-soft)] transition-colors ${
        skill.isEntry
          ? "border-brand-500/40 bg-brand-500/5"
          : "border-border-subtle bg-surface hover:bg-surface-2"
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
          skill.isEntry ? "bg-primary text-white" : "bg-primary/10 text-primary"
        }`}
      >
        <Icon className="size-[18px]" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
          {skill.isEntry && (
            <Badge variant="default" >START HERE</Badge>
          )}
          {skill.endpoint && (
            <Badge variant="secondary" >
              <code className="text-[10px]">{skill.endpoint}</code>
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
        <a
          href={getSkillBlobUrl(skill.id)}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-text-muted hover:text-primary mt-1 inline-flex items-center gap-1 break-all"
        >
          {url}
          <ExternalLink className="size-3" />
        </a>
      </div>

      <CopyButton value={url} />
    </div>
  );
}

export default function SkillsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <Card padding="md">
        <div className="text-xs text-text-muted mb-2">Paste this into your AI:</div>
        <div className="px-3 py-2 rounded bg-surface-2 font-mono text-[12px] text-text-main">
          Read this skill and use it: {getSkillRawUrl("9router")}
        </div>
      </Card>

      <div className="space-y-2">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill as unknown as Skill} />
        ))}
      </div>

      <Card padding="md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-text-main">More on GitHub</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Browse the source code, README and examples.
            </p>
          </div>
          <a
            href={`${SKILLS_REPO_URL}/tree/master/skills`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="size-4" />
            View on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}
