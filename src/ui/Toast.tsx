import { AnimatePresence, motion } from 'framer-motion';

export interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="toast"
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
        >
          <span data-testid="toast-text">{toast.message}</span>
          {toast.action && (
            <button type="button" className="toast-action" data-testid="toast-action" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
