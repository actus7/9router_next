"use client";

import { useState } from "react";
import { translate } from "@/i18n/runtime";
import type { Settings, StatusMessage } from "../types";

export function usePasswordChange(_settings: Settings) {
  const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" });
  const [passStatus, setPassStatus] = useState<StatusMessage>({ type: "", message: "" });
  const [passLoading, setPassLoading] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassStatus({ type: "error", message: translate("Passwords do not match") || "Passwords do not match" });
      return;
    }

    setPassLoading(true);
    setPassStatus({ type: "", message: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwords.current,
          newPassword: passwords.new,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setPassStatus({ type: "success", message: translate("Password updated successfully") || "Password updated successfully" });
        setPasswords({ current: "", new: "", confirm: "" });
      } else {
        setPassStatus({ type: "error", message: data.error || translate("Failed to update password") || "Failed to update password" });
      }
    } catch  {
      setPassStatus({ type: "error", message: translate("An error occurred") || "An error occurred" });
    } finally {
      setPassLoading(false);
    }
  };

  return {
    passwords,
    setPasswords,
    passStatus,
    setPassStatus,
    passLoading,
    setPassLoading,
    handlePasswordChange,
  };
}
