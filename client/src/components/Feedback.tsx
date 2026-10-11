import { AlertTriangle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Marks } from "./ui";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // Destructive actions get a red confirm button and the warning glyph
  danger?: boolean;
}

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  leaving?: boolean;
}

const TAG: Record<ToastTone, string> = { success: "OK", error: "FAIL", info: "NOTE" };

interface FeedbackApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  toast: (title: string, opts?: { tone?: ToastTone; body?: string }) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export const useConfirm = () => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useConfirm must be used inside <FeedbackProvider>");
  return ctx.confirm;
};

export const useToast = () => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useToast must be used inside <FeedbackProvider>");
  return ctx.toast;
};

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

const TOAST_MS = 3600;

export const FeedbackProvider = ({ children }: { children: ReactNode }) => {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog({ ...opts, resolve });
      }),
    [],
  );

  // play the exit animation, then drop it
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 180);
  }, []);

  const toast = useCallback<FeedbackApi["toast"]>(
    (title, opts) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, title, tone: opts?.tone ?? "success", body: opts?.body }]);
    },
    [],
  );

  const close = (ok: boolean) => {
    dialog?.resolve(ok);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      {dialog && <ConfirmDialog {...dialog} onClose={close} />}
      <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </FeedbackContext.Provider>
  );
};

// auto-dismisses after TOAST_MS; hovering pauses the countdown (and the bar)
const ToastItem = ({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) => {
  const remaining = useRef(TOAST_MS);
  const startedAt = useRef(0);
  const timer = useRef(0);
  const done = useRef(onDismiss);
  done.current = onDismiss;
  const run = () => {
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => done.current(), remaining.current);
  };
  const pause = () => {
    window.clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  };
  useEffect(() => {
    run();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`toast ${t.tone}${t.leaving ? " leaving" : ""}`} role={t.tone === "error" ? "alert" : "status"} onMouseEnter={pause} onMouseLeave={run}>
      <span className="toast-tag">{TAG[t.tone]}</span>
      <div className="toast-text">
        <strong>{t.title}</strong>
        {t.body && <span>{t.body}</span>}
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={13} strokeWidth={1.75} />
      </button>
      <i className="toast-timer" style={{ animationDuration: `${TOAST_MS}ms` }} />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Confirm dialog                                                              */
/* -------------------------------------------------------------------------- */

const ConfirmDialog = ({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    // Destructive dialogs focus Cancel so a stray Enter never deletes anything.
    (danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [danger]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog framed" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        <Marks />
        <div className="dialog-body">
          <span className={`dialog-glyph${danger ? " danger" : ""}`} aria-hidden>
            {danger ? <AlertTriangle size={15} /> : <Info size={15} />}
          </span>
          <div>
            <h2 id="dialog-title">{title}</h2>
            {body && <div className="dialog-text">{body}</div>}
          </div>
        </div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn ghost" onClick={() => onClose(false)}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className={`btn ${danger ? "destructive" : "primary"}`} onClick={() => onClose(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
