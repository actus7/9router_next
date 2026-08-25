"use client";

import React from "react";
import {
  Tooltip as TooltipPrimitive,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  text: string;
  children?: React.ReactNode;
  position?: TooltipPosition;
  color?: string;
}

export default function Tooltip({
  text,
  children,
  position = "top",
  color,
}: TooltipProps) {
  return (
    <TooltipProvider>
      <TooltipPrimitive>
        <TooltipTrigger render={<span className="inline-flex" />}>
          {children}
        </TooltipTrigger>
        <TooltipContent
          side={position}
          style={color ? { backgroundColor: color } : undefined}
          className={cn(color && "text-white")}
        >
          {text}
        </TooltipContent>
      </TooltipPrimitive>
    </TooltipProvider>
  );
}
