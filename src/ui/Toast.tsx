import { AnimatePresence, motion } from 'framer-motion';

export function Toast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          className="toast"
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
