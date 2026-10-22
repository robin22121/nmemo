/** 메모 포커스 화면(F1~F9)의 순수 계산: 메모 점 자리, 이동 순서, 조사. DOM 없음. */
import { getShape, sampleShape, type Box, type Pt, type Rect } from '../shapes';

/** F9: 점 지름·누르는 영역·점끼리 최소 중심 거리·점으로 보여 줄 최대 메모 수·먼지 상한 */
export const FOCUS = {
  dot: 12,
  hit: 36,
  minGap: 26,
  maxDots: 24,
  dust: 160,
  /** F3: 이만큼 넘게 움직이면 탭이 아님(px) */
  tapSlop: 8,
  /** F3: 가로로 이만큼 밀면 앞뒤 이동(px) */
  swipe: 40,
} as const;

/**
 * 윤곽을 따라 시간순으로 메모 점 자리를 고른다(avoid 밖). 점끼리 중심 거리 ≥ minGap.
 * 간격을 가장 넓게 벌릴 수 있는 만큼 벌려 고르게 놓고, n개를 못 놓으면 놓을 수 있는 만큼만(앞쪽부터) 돌려준다.
 */
export function spacedPositions(shapeId: string | undefined, n: number, box: Box, avoid?: Rect, minGap: number = FOCUS.minGap): Pt[] {
  if (!(n > 0)) return [];
  const cand = sampleShape(getShape(shapeId), Math.max(600, n * 30), box, avoid);
  const pick = (gap: number): Pt[] => {
    const out: Pt[] = [];
    for (const p of cand) {
      if (out.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap)) out.push(p);
      if (out.length > n) break;
    }
    return out;
  };
  let best = pick(minGap);
  if (best.length < n) return best;
  // 간격을 넓혀도 n개가 나오는 가장 큰 간격을 찾는다(점이 윤곽 앞쪽에 몰리지 않게)
  let lo = minGap;
  let hi = Math.hypot(box.w, box.h);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const got = pick(mid);
    if (got.length >= n) {
      lo = mid;
      best = got;
    } else hi = mid;
  }
  return best.slice(0, n);
}

/** 받침이 있으면 '과', 없으면 '와'(한글이 아니면 '와') */
export function josaWa(word: string): '와' | '과' {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return '와';
  return (c - 0xac00) % 28 === 0 ? '와' : '과';
}

/** 삭제 뒤 보여 줄 메모: 다음(오름차순), 마지막이면 이전, 하나도 없으면 null(F6) */
export function afterDelete(order: readonly string[], id: string): string | null {
  const i = order.indexOf(id);
  if (i < 0) return null;
  return order[i + 1] ?? order[i - 1] ?? null;
}

/** 가장 가까운 점(누르는 영역 반경 안) */
export function nearestDot(dots: readonly { id: string; x: number; y: number }[], x: number, y: number, r: number = FOCUS.hit / 2): string | null {
  let best: { id: string; d: number } | null = null;
  for (const p of dots) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= r && (!best || d < best.d)) best = { id: p.id, d };
  }
  return best?.id ?? null;
}
