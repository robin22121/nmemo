import { motion } from 'framer-motion';
import { memo as reactMemo } from 'react';
import { hashUnit } from '../core/layout/seededRandom';
import type { Memo } from '../db/schema';
import { CheckIcon } from './icons';
import { useObjectUrl } from './hooks';

export interface MemoCardProps {
  memo: Memo;
  x: number;
  y: number;
  dim?: boolean;
  glow?: boolean;
  /** 관련 카드가 끌려오는 오프셋(월드 px) */
  pull?: { x: number; y: number };
  onToggleDone?: (id: string, done: boolean) => void;
}

export function cardText(m: Memo): string {
  return m.summary?.trim() || m.text.trim().slice(0, 40) || '사진';
}

function CardFace({ memo, onToggleDone }: Pick<MemoCardProps, 'memo' | 'onToggleDone'>) {
  const url = useObjectUrl(memo.input === 'photo' ? memo.photo : undefined);
  const text = cardText(memo);
  if (memo.input === 'photo') {
    return (
      <div className="face photo">
        <span className="photo-thumb" style={url ? { backgroundImage: `url(${url})` } : undefined} />
        <span className="face-text">{text}</span>
      </div>
    );
  }
  switch (memo.kind) {
    case 'emotion':
      return (
        <div className="face emotion" style={{ ['--emo' as string]: memo.emotion?.color ?? '#c9c2b0' }}>
          <span className="face-text">{text}</span>
        </div>
      );
    case 'todo':
      return (
        <div className={`face todo${memo.done ? ' done' : ''}`}>
          <button
            type="button"
            className="todo-check"
            aria-label={memo.done ? '완료 취소' : '완료'}
            aria-pressed={!!memo.done}
            data-todo-check
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone?.(memo.id, !memo.done);
            }}
          >
            {memo.done && <CheckIcon />}
          </button>
          <span className="face-text">{text}</span>
        </div>
      );
    default:
      return (
        <div className="face idea">
          <span className="face-text">{text}</span>
        </div>
      );
  }
}

function MemoCardImpl({ memo, x, y, dim, glow, pull, onToggleDone }: MemoCardProps) {
  const tilt = memo.kind === 'idea' && memo.input !== 'photo' ? hashUnit(memo.id) * 3.5 : hashUnit(memo.id) * 1.2;
  const px = x + (pull?.x ?? 0);
  const py = y + (pull?.y ?? 0);
  const phase = (hashUnit(memo.id, 'f') + 1) / 2; // 0..1
  return (
    <motion.div
      className={`card-pos${dim ? ' dim' : ''}${glow ? ' glow' : ''}`}
      data-memo-id={memo.id}
      data-kind={memo.input === 'photo' ? 'photo' : memo.kind}
      initial={{ x: px, y: py }}
      animate={{ x: px, y: py }}
      transition={{ type: 'spring', stiffness: 170, damping: 22 }}
    >
      <div
        className="card-float"
        style={{ ['--fd' as string]: `${-phase * 9}s`, ['--fp' as string]: `${7 + phase * 3}s` }}
      >
        <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${tilt}deg)` }}>
          <CardFace memo={memo} onToggleDone={onToggleDone} />
        </div>
      </div>
    </motion.div>
  );
}

export const MemoCard = reactMemo(MemoCardImpl);
