"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getCurrentLocale, onLocaleChange, translate } from "@/i18n/runtime";
import {
  CAVEMAN_LEVELS,
  NEUTRALITY_LEVELS,
  PONYTAIL_LEVELS,
  SYNAPSE_LEVELS,
  WENYAN_LOCALES,
  type AbilityLevelOption,
} from "@/shared/gateway/abilityLevels";
import type { GatewayAbilities, LeveledAbility } from "@/shared/gateway/gatewayProfile";

function t(text: string): string {
  return translate(text) || text;
}

type Props = {
  value: GatewayAbilities;
  onChange: (next: GatewayAbilities) => void;
  disabled?: boolean;
};

function Row({
  title,
  link,
  linkLabel,
  description,
  checked,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  link?: string;
  linkLabel?: string;
  description: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="min-w-56 flex-1">
        <p className="font-medium">
          {t(title)}{" "}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-normal text-primary underline hover:opacity-80"
            >
              ({linkLabel})
            </a>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">{t(description)}</p>
      </div>
      <div className="ms-auto flex flex-wrap items-center justify-end gap-3">
        {checked ? children : null}
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onToggle}
          aria-label={t(title)}
        />
      </div>
    </div>
  );
}

function LevelPicker({
  levels,
  ability,
  onChange,
  disabled,
}: {
  levels: readonly AbilityLevelOption[];
  ability: LeveledAbility;
  onChange: (level: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-60 max-w-full shrink-0 flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {levels.map((level) => (
          <Button
            key={level.id}
            type="button"
            variant={ability.level === level.id ? "default" : "outline"}
            size="sm"
            disabled={disabled}
            onClick={() => onChange(level.id)}
            title={t(level.desc)}
          >
            {t(level.label)}
          </Button>
        ))}
      </div>
      <p className="text-end text-xs text-primary">
        {t(levels.find((level) => level.id === ability.level)?.desc || "")}
      </p>
    </div>
  );
}

/**
 * The gateway abilities (formerly the Token Saver page), as one controlled
 * editor. Where the value lives is the caller's business: an API key's profile
 * on the Endpoint page, a conversation's plugin settings in the chat.
 */
export default function AbilitiesEditor({ value, onChange, disabled }: Props) {
  const [locale, setLocale] = useState(() => getCurrentLocale());
  useEffect(() => onLocaleChange(() => setLocale(getCurrentLocale())), []);
  const cavemanLevels = WENYAN_LOCALES.includes(locale)
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((level) => !level.wenyan || level.id === value.caveman.level);

  const set = (patch: Partial<GatewayAbilities>) => onChange({ ...value, ...patch });

  return (
    <div>
      <Row
        title="Compress tool output"
        link="https://github.com/rtk-ai/rtk"
        linkLabel="RTK"
        description="git/grep/ls/tree/logs → 60-90% fewer input tokens"
        checked={value.rtk}
        disabled={disabled}
        onToggle={(rtk) => set({ rtk })}
      />
      <Row
        title="Compress LLM output"
        link="https://github.com/JuliusBrussee/caveman"
        linkLabel="Caveman"
        description="Terse-style system prompt → ~65% fewer output tokens (up to 87%)"
        checked={value.caveman.enabled}
        disabled={disabled}
        onToggle={(enabled) => set({ caveman: { ...value.caveman, enabled } })}
      >
        <LevelPicker
          levels={cavemanLevels}
          ability={value.caveman}
          disabled={disabled}
          onChange={(level) => set({ caveman: { ...value.caveman, level } })}
        />
      </Row>
      <Row
        title="Lazy senior dev"
        link="https://github.com/DietrichGebert/ponytail"
        linkLabel="Ponytail"
        description="Bias the model toward minimal code: YAGNI, reuse stdlib, deletion over addition"
        checked={value.ponytail.enabled}
        disabled={disabled}
        onToggle={(enabled) => set({ ponytail: { ...value.ponytail, enabled } })}
      >
        <LevelPicker
          levels={PONYTAIL_LEVELS}
          ability={value.ponytail}
          disabled={disabled}
          onChange={(level) => set({ ponytail: { ...value.ponytail, level } })}
        />
      </Row>
      <Row
        title="Ideological neutrality"
        description="Keep answers evidence-based and ideologically neutral: jargon is rewritten as technical description, no activism or value prescription"
        checked={value.neutrality.enabled}
        disabled={disabled}
        onToggle={(enabled) => set({ neutrality: { ...value.neutrality, enabled } })}
      >
        <LevelPicker
          levels={NEUTRALITY_LEVELS}
          ability={value.neutrality}
          disabled={disabled}
          onChange={(level) => set({ neutrality: { ...value.neutrality, level } })}
        />
      </Row>
      <Row
        title="Trivial local responses"
        link="https://github.com/actus7/synapse"
        linkLabel="Synapse"
        description="Answers greetings, thanks and goodbyes at the gateway without spending tokens; with no clear match, the message continues to the model. Never runs when a tool is required or already in use"
        checked={value.synapse.enabled}
        disabled={disabled}
        onToggle={(enabled) => set({ synapse: { ...value.synapse, enabled } })}
      >
        <LevelPicker
          levels={SYNAPSE_LEVELS}
          ability={value.synapse}
          disabled={disabled}
          onChange={(level) => set({ synapse: { ...value.synapse, level } })}
        />
      </Row>
      {value.synapse.enabled ? (
        <label className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="flex-1">
            <span className="font-medium">{t("Learn answers (Synapse Loop)")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("Repeated questions are answered from what this account already learned")}
            </span>
          </span>
          <Switch
            className="ms-auto"
            checked={value.synapse.learning}
            disabled={disabled}
            onCheckedChange={(learning) => set({ synapse: { ...value.synapse, learning } })}
            aria-label={t("Learn answers (Synapse Loop)")}
          />
        </label>
      ) : null}
      {/* pxpipe stays in the profile but hidden, like its old section
          (PXPIPE_UI_ENABLED = false): the feature is experimental. */}
      <div className="flex items-center justify-between gap-4 border-t border-border py-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium">MetaBreak</p>
          <p className="text-sm text-muted-foreground">
            {t("Direct answers, complete work and persistence with tools. A fixed profile, with no prompt editing.")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Experimental: adds context, not token compression. Results depend on the model and provider.")}
          </p>
        </div>
        <Switch
          checked={value.metaBreak}
          disabled={disabled}
          onCheckedChange={(metaBreak) => set({ metaBreak })}
          aria-label="MetaBreak"
        />
      </div>
    </div>
  );
}
