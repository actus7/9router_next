"use client";

interface StatusInfo {
  type: string;
  message: string;
}

interface StatusAlertProps {
  status: StatusInfo;
  className?: string;
}

/** Reusable status alert */
export default function StatusAlert({ status, className = "" }: StatusAlertProps) {
  const renderMessage = (msg: string) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">{part}</a>
        : part
    );
  };

  return (
    <div className={`p-2 rounded text-sm ${className} ${status.type === "success" ? "bg-success/10 text-success-foreground" :
        status.type === "warning" ? "bg-warning/10 text-warning-foreground" :
        status.type === "info" ? "bg-info/10 text-info-foreground" :
          "bg-destructive/10 text-destructive"
      }`}>
      {renderMessage(status.message)}
    </div>
  );
}
