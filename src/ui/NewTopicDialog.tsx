import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { spring } from '../motion/presets';

interface Props {
  open: boolean;
  suggestion: string;
  onCancel: () => void;
  onCreate: (name: string) => void;
}

/** 카드를 빈 곳에 놓았을 때: 새 주제 만들기 확인 */
export function NewTopicDialog({ open, suggestion, onCancel, onCreate }: Props) {
  const [name, setName] = useState(suggestion);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setName(suggestion);
      setTimeout(() => input.current?.select(), 60);
    }
  }, [open, suggestion]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}>
          <motion.form
            className="dialog"
            data-testid="new-topic-dialog"
            role="dialog"
            aria-label="새 주제 만들기"
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={spring.snappy}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onCreate(name.trim());
            }}
          >
            <h2>새 주제 만들기</h2>
            <p>이 메모만의 새 무리를 만들까요?</p>
            <input ref={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} aria-label="주제 이름" data-testid="new-topic-name" />
            <div className="dialog-actions">
              <button type="button" onClick={onCancel}>취소</button>
              <button type="submit" className="primary" disabled={!name.trim()} data-testid="new-topic-create">만들기</button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
