import { hashUnit } from '../core/layout/seededRandom';
import type { Memo } from '../db/schema';
import { CheckIcon } from './icons';
import { useObjectUrl } from './hooks';

export function cardText(m: Memo): string {
  return m.summary?.trim() || m.text.trim().slice(0, 40) || '사진';
}

export function CardFace({ memo, onToggleDone }: { memo: Memo; onToggleDone?: (id: string, done: boolean) => void }) {
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

export function cardTilt(m: Pick<Memo, 'id' | 'kind' | 'input'>): number {
  return m.kind === 'idea' && m.input !== 'photo' ? hashUnit(m.id) * 3.5 : hashUnit(m.id) * 1.2;
}
