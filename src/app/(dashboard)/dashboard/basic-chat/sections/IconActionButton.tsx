"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface IconActionButtonProps extends ComponentProps<typeof Button> {
  tooltip: ReactNode;
}

/** Icon-only button with a hover tooltip carrying its label — the label doubles as `aria-label` when none is set. */
export default function IconActionButton({ tooltip, children, variant = "ghost", size = "icon-sm", "aria-label": ariaLabel, ...buttonProps }: IconActionButtonProps) {
  const label = ariaLabel ?? (typeof tooltip === "string" ? tooltip : undefined);
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant={variant} size={size} aria-label={label} {...buttonProps} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
