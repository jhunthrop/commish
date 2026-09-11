"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEntranceClass } from "@/design/use-motion";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { UI_CONFIG } from "./config";
import { Button } from "./button";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastInput {
  /** Plain language: what happened, and what to do next. Never raw exception text. */
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
}

interface ToastEntry extends ToastInput {
  readonly id: number;
}

export interface ToastApi {
  readonly show: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Readonly<Record<ToastTone, string>> = {
  info: "border-line",
  success: "border-positive",
  error: "border-negative",
};

function ToastItem({
  toast,
  dismissMs,
  onDismiss,
}: {
  readonly toast: ToastEntry;
  readonly dismissMs: number;
  readonly onDismiss: (id: number) => void;
}) {
  // P4's arrival verb: a toast is something that LANDED, so it springs in like every other thing
  // that appears in this system. Reduced motion returns an empty class, never a shorter spring.
  const entrance = useEntranceClass();

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), dismissMs);
    return () => clearTimeout(timer);
  }, [toast.id, dismissMs, onDismiss]);

  const tone = toast.tone ?? "info";
  return (
    <li className={`pointer-events-auto ${entrance}`}>
      {/*
       * `role="alert"` lives on this inner div, not the <li>: ARIA-in-HTML forbids overriding
       * an <li>'s implicit `listitem` role with `alert`, and axe's `list` rule then flags the
       * <ul> for containing a non-listitem child. A plain <li> wrapping an alert region keeps
       * both the list structure and the assertive announcement intact.
       */}
      <div
        role={tone === "error" ? "alert" : undefined}
        // SIDELINE WAVE TWO: a toast is a small card, so it takes the card corner (`shape.card`,
        // 20px) and the overlay shadow it needs to read as floating over the page rather than
        // sitting in it. The tone stays a 1px boundary and never a fill: a toast is a sentence.
        className={`flex items-start gap-3 rounded-xl border bg-surface-elevated p-3 text-sm text-text-primary shadow-overlay ${TONE[tone]}`}
      >
        <span className="grow">{toast.message}</span>
        {toast.action ? (
          <Button size="sm" variant="secondary" onClick={toast.action.onClick}>
            {toast.action.label}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onDismiss(toast.id)}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

/**
 * One polite live region for the whole app. Error toasts additionally carry `role="alert"`
 * so a failed draft action interrupts — the user is on a clock and cannot wait for a polite
 * announcement queue.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const nextId = useRef(0);
  const reduced = usePrefersReducedMotion();
  const dismissMs = reduced ? UI_CONFIG.toast.reducedMotionDismissMs : UI_CONFIG.toast.dismissMs;

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    // The id is minted OUTSIDE the updater: a state updater must stay pure, and React may
    // invoke it twice in development StrictMode.
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list, { ...input, id }].slice(-UI_CONFIG.toast.maxVisible));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ul
        data-testid="toast-region"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-md flex-col gap-2 p-4"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} dismissMs={dismissMs} onDismiss={dismiss} />
        ))}
      </ul>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}
