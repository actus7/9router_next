"use client";

import Button from "@/shared/components/Button";
import { translate } from "@/i18n/runtime";

interface MethodCardProps {
  icon: React.ReactNode; title: string; description: string;
  onClick: () => void; hidden?: boolean;
}

export function MethodCard({ icon, title, description, onClick, hidden }: MethodCardProps) {
  return (
    <Button onClick={onClick} variant="outline" className={`${hidden ? "hidden " : ""}w-full p-4 text-left rounded-lg hover:bg-sidebar transition-colors h-auto justify-start whitespace-normal`}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold mb-1">{translate(title) || title}</h3>
          <p className="text-sm text-text-muted">{translate(description) || description}</p>
        </div>
      </div>
    </Button>
  );
}
