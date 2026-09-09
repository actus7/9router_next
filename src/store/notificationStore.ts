/**
 * Notification Store — Zustand-based global toast notification system.
 * Centralized feedback for dashboard actions.
 */

import { create } from "zustand";

type NotificationType = "info" | "success" | "warning" | "error";

interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  title: string | null;
  duration: number;
  dismissible: boolean;
  createdAt: number;
}

interface NotificationInput {
  type?: NotificationType;
  message: string;
  title?: string;
  duration?: number;
  dismissible?: boolean;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (notification: NotificationInput) => number;
  removeNotification: (id: number) => void;
  clearAll: () => void;
  success: (message: string, title?: string) => number;
  error: (message: string, title?: string) => number;
  warning: (message: string, title?: string) => number;
  info: (message: string, title?: string) => number;
}

let idCounter = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addNotification: (notification: NotificationInput) => {
    const id = ++idCounter;
    const entry: Notification = {
      id,
      type: notification.type || "info",
      message: notification.message,
      title: notification.title || null,
      duration: notification.duration ?? 5000,
      dismissible: notification.dismissible ?? true,
      createdAt: Date.now(),
    };

    set((s) => ({ notifications: [...s.notifications, entry] }));

    // Auto-dismiss
    if (entry.duration > 0) {
      setTimeout(() => get().removeNotification(id), entry.duration);
    }

    return id;
  },

  removeNotification: (id: number) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },

  clearAll: () => set({ notifications: [] }),

  success: (message: string, title?: string) => get().addNotification({ type: "success", message, title }),
  error: (message: string, title?: string) => get().addNotification({ type: "error", message, title, duration: 8000 }),
  warning: (message: string, title?: string) => get().addNotification({ type: "warning", message, title }),
  info: (message: string, title?: string) => get().addNotification({ type: "info", message, title }),
}));

/**
 * Stable handle for firing toasts.
 *
 * Calling `useNotificationStore()` with no selector subscribes to the whole
 * state object, and every toast (and every auto-dismiss 5s later) replaces it.
 * Components that only ever *fire* notifications were therefore re-rendering on
 * every toast, and the ones that listed the value in a `useEffect` dependency
 * array re-ran the effect — a hook that fetches and warns on failure then warns,
 * gets a new reference, and fetches again, forever.
 *
 * The actions themselves never change, so read them off the store instead of
 * subscribing. `useNotificationStore((s) => s.notifications)` with a selector is
 * still the right way to *render* the list.
 */
export const notify = {
  success: (message: string, title?: string): number => useNotificationStore.getState().success(message, title),
  error: (message: string, title?: string): number => useNotificationStore.getState().error(message, title),
  warning: (message: string, title?: string): number => useNotificationStore.getState().warning(message, title),
  info: (message: string, title?: string): number => useNotificationStore.getState().info(message, title),
};
