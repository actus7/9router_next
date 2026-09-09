"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AlertCircle, CheckCircle, Info, TriangleAlert, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

type ToastType = "success" | "error" | "warning" | "info";

function getToastStyle(type: ToastType) {
  if (type === "success") {
    return {
      wrapper: "border-success-border/30 bg-success/10 text-success",
      icon: <CheckCircle className="size-[18px] leading-5" />,
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-destructive/30 bg-destructive/10 text-destructive",
      icon: <AlertCircle className="size-[18px] leading-5" />,
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-warning-border/30 bg-warning/10 text-warning",
      icon: <TriangleAlert className="size-[18px] leading-5" />,
    };
  }
  return {
    wrapper: "border-info-border/30 bg-info/10 text-info",
    icon: <Info className="size-[18px] leading-5" />,
  };
}

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <SidebarProvider className="min-h-0 h-screen w-full overflow-hidden bg-bg">
      {/* Skip to content for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:outline-none"
      >
        {translate("Skip to content") || "Skip to content"}
      </a>
      <div
        aria-live="polite"
        aria-label={translate("Notifications") || "Notifications"}
        className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2"
      >
        {notifications.map((n) => {
          const style = getToastStyle(n.type as ToastType);
          return (
            <div
              key={n.id}
              className={`rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                {style.icon}
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label={translate("Dismiss notification") || "Dismiss notification"}
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Sidebar />

      <SidebarInset id="main-content" className="relative overflow-hidden transition-colors duration-300 isolate">
        {/* Faint grid background */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header />
        <div className={`flex-1 overflow-y-auto custom-scrollbar ${pathname === "/dashboard/basic-chat" ? "" : "p-6 lg:p-10"} ${pathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}>
          <div className={`${pathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
