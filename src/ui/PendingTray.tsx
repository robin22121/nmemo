import { motion } from 'framer-motion';
import type { Memo } from '../db/schema';
import { useObjectUrl } from './hooks';

function PendingCard({ memo }: { memo: Memo }) {
  const url = useObjectUrl(memo.photo);
  const failed = memo.status === 'failed';
  return (
    <motion.div
      layoutId={`memo-${memo.id}`}
      className={`pending-card${failed ? ' failed' : ''}`}
      data-testid="pending-card"
      data-memo-id={memo.id}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
    >
      {url && <img src={url} alt="" className="pending-thumb" />}
      <span className="pending-text">{memo.text || (memo.input === 'photo' ? '사진' : '…')}</span>
    </motion.div>
  );
}

export function PendingTray({ memos }: { memos: Memo[] }) {
  if (memos.length === 0) return null;
  return (
    <div className="pending-tray" aria-label="정돈을 기다리는 메모">
      {memos.map((m) => (
        <PendingCard key={m.id} memo={m} />
      ))}
    </div>
  );
}
