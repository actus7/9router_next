import type { KeyboardEvent } from "react";

export function expandableCardHeaderProps(onToggle: () => void, isExpanded?: boolean) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onToggle,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onToggle();
      }
    },
    "aria-expanded": isExpanded,
  };
}
