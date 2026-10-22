import type { Transition } from 'framer-motion';

/** 모든 움직임은 spring이 기본(stiffness 180~320, damping 18~26). 위치는 transform(x,y,scale)만 쓴다. */
export const spring = {
  /** 카드가 자리를 옮길 때(이웃이 비켜줄 때) */
  settle: { type: 'spring', stiffness: 180, damping: 22 } satisfies Transition,
  /** 톡 떠오르기, 눌림 반응 */
  snappy: { type: 'spring', stiffness: 320, damping: 24 } satisfies Transition,
  /** 도착해서 붙을 때/피어날 때 약간 튕김 */
  bouncy: { type: 'spring', stiffness: 260, damping: 18 } satisfies Transition,
  /** 무리 열기/닫기 같은 큰 이동 */
  glide: { type: 'spring', stiffness: 200, damping: 26 } satisfies Transition,
};

/** 정돈 완료 비행 시간(초) */
export const FLIGHT_SECONDS = 0.95;

export interface Pt { x: number; y: number }

/**
 * 포물선 경로의 키워드 프레임(3점). 중간 제어점이 두 끝점보다 위로 솟는다.
 * apex 위치는 t(0~1) 지점에서 중간점을 잡는다.
 */
export function arcKeyframes(from: Pt, to: Pt, lift = 120, t = 0.45): { x: number[]; y: number[]; times: number[] } {
  const mx = from.x + (to.x - from.x) * t;
  const baseY = from.y + (to.y - from.y) * t;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const my = Math.min(from.y, to.y, baseY) - Math.min(lift, 40 + dist * 0.25);
  return { x: [from.x, mx, to.x], y: [from.y, my, to.y], times: [0, t, 1] };
}
