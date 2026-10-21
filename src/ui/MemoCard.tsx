import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { memo as reactMemo, useEffect } from 'react';
import { hashUnit } from '../core/layout/seededRandom';
import type { Memo } from '../db/schema';
import { arcKeyframes, REORG_FLIGHT_SECONDS, spring } from '../motion/presets';
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
  /** 날아오는 중이라 아직 보이지 않음 */
  hidden?: boolean;
  /** 새로 생겨서 피어나듯 나타남(첫 로딩 때는 아님) */
  appear?: boolean;
  /** 값이 바뀔 때마다 도착 팝 */
  popToken?: number;
  /** 값이 바뀔 때마다 무리 출렁임(오프셋은 무리 중심 기준) */
  wobbleToken?: number;
  wobble?: { x: number; y: number };
  /** 재구성: 이전 자리에서 포물선으로 이동 */
  arc?: { from: { x: number; y: number }; delay: number };
  onArcDone?: (id: string) => void;
  onToggleDone?: (id: string, done: boolean) => void;
}

export function cardText(m: Memo): string {
  return m.summary?.trim() || m.text.trim().slice(0, 40) || '사진';
}

export function CardFace({ memo, onToggleDone }: Pick<MemoCardProps, 'memo' | 'onToggleDone'>) {
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

function MemoCardImpl(p: MemoCardProps) {
  const { memo, x, y, dim, glow, pull, hidden, appear, popToken, wobbleToken, wobble, arc, onArcDone, onToggleDone } = p;
  const reduced = useReducedMotion();
  const fx = useAnimationControls();
  const px = x + (pull?.x ?? 0);
  const py = y + (pull?.y ?? 0);
  const phase = (hashUnit(memo.id, 'f') + 1) / 2;

  // 도착 팝: 붙으면서 살짝 부풀었다 돌아옴
  useEffect(() => {
    if (!popToken || reduced) return;
    void fx.start({ scale: [1.16, 1], transition: spring.bouncy });
  }, [popToken, reduced, fx]);

  // 무리 출렁임: 중심에서 바깥으로 살짝 밀렸다 돌아옴
  useEffect(() => {
    if (!wobbleToken || reduced || !wobble) return;
    void fx.start({
      x: [0, wobble.x, 0],
      y: [0, wobble.y, 0],
      transition: { duration: 0.7, ease: 'easeOut', times: [0, 0.35, 1] },
    });
  }, [wobbleToken, reduced, wobble, fx]);

  const useArc = !!arc && !reduced;
  const kf = useArc ? arcKeyframes(arc!.from, { x: px, y: py }, 110) : null;

  return (
    <motion.div
      className={`card-pos${dim ? ' dim' : ''}${glow ? ' glow' : ''}`}
      data-memo-id={memo.id}
      data-kind={memo.input === 'photo' ? 'photo' : memo.kind}
      style={{ opacity: hidden ? 0 : undefined, visibility: hidden ? 'hidden' : undefined }}
      initial={appear ? { x: px, y: py, scale: 0.4, opacity: 0 } : { x: px, y: py }}
      animate={
        kf
          ? { x: kf.x, y: kf.y, scale: 1, opacity: 1 }
          : { x: px, y: py, scale: 1, opacity: 1 }
      }
      transition={
        kf
          ? {
              delay: arc!.delay,
              x: { duration: REORG_FLIGHT_SECONDS, times: kf.times, ease: 'easeInOut' },
              y: { duration: REORG_FLIGHT_SECONDS, times: kf.times, ease: ['easeOut', 'easeIn'] },
            }
          : appear
            ? { ...spring.bouncy, opacity: { duration: 0.25 } }
            : spring.settle
      }
      onAnimationComplete={() => {
        if (arc) onArcDone?.(memo.id);
      }}
    >
      <motion.div className="card-fx" animate={fx}>
        <div className="card-float" style={{ ['--fd' as string]: `${-phase * 9}s`, ['--fp' as string]: `${7 + phase * 3}s` }}>
          <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(memo)}deg)` }}>
            <CardFace memo={memo} onToggleDone={onToggleDone} />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export const MemoCard = reactMemo(MemoCardImpl);
