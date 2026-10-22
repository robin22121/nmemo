import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { Memo, Topic } from '../../db/schema';
import { spring } from '../../motion/presets';
import { useObjectUrl } from '../hooks';
import { CloseIcon } from '../icons';
import { cardText } from '../MemoCard';
import { fmtDate, KIND_LABEL } from '../MemoFocus';

function Row({ memo, onPick }: { memo: Memo; onPick: (id: string) => void }) {
  const url = useObjectUrl(memo.input === 'photo' ? memo.photo : undefined);
  return (
    <li>
      <button type="button" className="tl-row" onClick={() => onPick(memo.id)}>
        {memo.input === 'photo' ? (
          <span className="tl-thumb" style={url ? { backgroundImage: `url(${url})` } : undefined} />
        ) : (
          <span className="chip kind tl-kind">{KIND_LABEL[memo.kind ?? 'idea']}</span>
        )}
        <span className="tl-text">{cardText(memo)}</span>
        <span className="tl-date">{fmtDate(memo.createdAt)}</span>
      </button>
    </li>
  );
}

/**
 * 주제의 메모 전체 목록(D18): 펼친 주제의 "+N"을 누르면 열린다. 최신순, 줄을 누르면 메모 상세.
 * 메모 상세 시트와 같은 모양·닫기(바깥 탭, 아래로 끌기).
 */
export function TopicListSheet({ topic, memos, onClose, onPick }: { topic: Topic | null; memos: Memo[]; onClose: () => void; onPick: (id: string) => void }) {
  const controls = useDragControls();
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 500) onClose();
  };
  const sorted = [...memos].sort((a, b) => b.createdAt - a.createdAt);
  // "+N"을 누른 손가락의 뒤이은 click이 막 나타난 바깥 덮개에 떨어져 바로 닫히지 않게 잠깐 무시한다
  const openedAt = useRef(0);
  useEffect(() => {
    if (topic?.id) openedAt.current = performance.now();
  }, [topic?.id]);
  return (
    <AnimatePresence>
      {topic && (
        <>
          <motion.div key="tl-back" className="tl-backdrop" data-no-pan onClick={() => performance.now() - openedAt.current > 400 && onClose()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.section
            key="tl-sheet"
            className="sheet tl-sheet"
            data-no-pan
            data-testid="topic-list-sheet"
            role="dialog"
            aria-label={`${topic.name} 메모 전체`}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={spring.glide}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragListener={false}
            dragControls={controls}
            onDragEnd={onDragEnd}
          >
            <div className="sheet-grabber" onPointerDown={(e) => controls.start(e)} aria-hidden />
            <div className="sheet-head">
              <strong className="tl-title">{topic.name}</strong>
              <span className="sheet-date">{sorted.length}개</span>
              <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
                <CloseIcon />
              </button>
            </div>
            <ul className="sheet-scroll tl-list">
              {sorted.map((m) => (
                <Row key={m.id} memo={m} onPick={onPick} />
              ))}
            </ul>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
