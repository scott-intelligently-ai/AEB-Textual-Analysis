"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { errorMessage } from "@/lib/client/api";
import { Button, Modal, cx } from "./ui";

interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface Feedback {
  notify: (message: string) => void;
  notifyError: (error: unknown) => void;
  /** Resolves true when the user confirms, false when they cancel. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("useFeedback must be used inside FeedbackProvider");
  return feedback;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    // Errors stay longer: they usually need reading.
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      kind === "error" ? 9000 : 4000,
    );
  }, []);

  const feedback = useMemo<Feedback>(
    () => ({
      notify: (message) => push("success", message),
      notifyError: (error) => push("error", errorMessage(error)),
      confirm: (options) =>
        new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    }),
    [push],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}
      {pending ? (
        <Modal
          title={pending.title}
          onClose={() => settle(false)}
          footer={
            <>
              <Button onClick={() => settle(false)}>Cancel</Button>
              <Button variant={pending.danger ? "danger" : "primary"} onClick={() => settle(true)}>
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          <div className="leading-6">{pending.body}</div>
        </Modal>
      ) : null}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto rounded-lg px-4 py-3 text-sm leading-5 shadow-lg ring-1",
              toast.kind === "error"
                ? "bg-red-50 text-red-900 ring-red-200"
                : "bg-zinc-900 text-white ring-zinc-900",
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}
