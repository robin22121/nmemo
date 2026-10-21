import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Memo } from '../db/schema';
import { BREATH, spring } from '../motion/presets';
import { useObjectUrl } from './hooks';

function PendingCard({ memo, onRetry }: { memo: Memo; onRetry: (id: string) => void }) {
  const url = useObjectUrl(memo.photo);
  const reduced = useReducedMotion();
  const failed = memo.status === 'failed';
  return (
    <motion.div
      layout
      // 저장: 입력 바 쪽에서 톡 떠올라 대기 자리로 / 정돈 중: 숨쉬듯 천천히 커졌다 작아짐
      initial={{ y: 56, scale: 0.7, opacity: 0 }}
      animate={{
        y: 0,
        opacity: 1,
        scale: failed || reduced ? 1 : BREATH.animate.scale,
        transition: {
          y: spring.snappy,
          opacity: { duration: 0.2 },
          scale: failed || reduced ? spring.snappy : BREATH.transition,
        },
      }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className={`pending-card${failed ? ' failed' : ''}`}
      data-testid="pending-card"
      data-pending-id={memo.id}
      onClick={failed ? () => onRetry(memo.id) : undefined}
      title={failed ? '눌러서 다시 시도' : undefined}
    >
      {url && <img src={url} alt="" className="pending-thumb" />}
      <span className="pending-text">{memo.text || (memo.input === 'photo' ? '사진' : '…')}</span>
    </motion.div>
  );
}

export function PendingTray({ memos, onRetry }: { memos: Memo[]; onRetry: (id: string) => void }) {
  return (
    <div className="pending-tray" aria-label="정돈을 기다리는 메모" data-empty={memos.length === 0}>
      <AnimatePresence initial={false}>
        {memos.map((m) => (
          <PendingCard key={m.id} memo={m} onRetry={onRetry} />
        ))}
      </AnimatePresence>
    </div>
  );
}
