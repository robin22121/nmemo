import { motion } from 'framer-motion';
import { hashUnit } from '../core/layout/seededRandom';

export interface LineTarget { id: string; x: number; y: number; strength: number }

/** 눌린 카드에서 관련 카드로 이어지는 가는 곡선. pathLength 0→1로 그려진다. */
export function RelatedLines({ from, targets, color = '#8a6d1f' }: { from: { x: number; y: number }; targets: LineTarget[]; color?: string }) {
  return (
    <svg className="related-lines" aria-hidden>
      {targets.map((t, i) => {
        const dx = t.x - from.x, dy = t.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const bend = (0.16 + 0.06 * hashUnit(t.id, 'l')) * len * (i % 2 === 0 ? 1 : -1);
        const cx = (from.x + t.x) / 2 - (dy / len) * bend;
        const cy = (from.y + t.y) / 2 + (dx / len) * bend;
        return (
          <motion.path
            key={t.id}
            d={`M ${from.x} ${from.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={1.2 + t.strength * 1.6}
            strokeOpacity={0.35 + t.strength * 0.4}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ pathLength: { duration: 0.55, delay: i * 0.05, ease: 'easeOut' }, opacity: { duration: 0.15 } }}
          />
        );
      })}
    </svg>
  );
}
