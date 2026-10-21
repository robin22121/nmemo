import { animate } from 'framer-motion';
import { useCallback, useEffect, useRef } from 'react';

export interface View { x: number; y: number; k: number }

export const MIN_K = 0.3;
export const MAX_K = 2.4;

export interface GestureHandlers {
  /** 짧게 눌렀다 뗌(이동 거의 없음) */
  onTap?: (e: PointerEvent, world: { x: number; y: number }) => void;
  /** 한 점을 누른 채 120ms 이상 가만히 있음 — 눌린 카드의 관련 메모 강조 등 */
  onPressStart?: (target: Element, world: { x: number; y: number }) => void;
  onPressEnd?: () => void;
  /** 누르기 시작이 카드/무리 위인지 — 드래그 이동 등 확장용 */
  shouldIgnore?: (target: Element) => boolean;
}

/**
 * 보드 뷰포트: 두 손가락 확대/이동, 휠 확대, 드래그 이동. 상태는 ref에 두고
 * 컨텐츠에는 transform 하나만 직접 써서(React 리렌더 없음) 매끈하게 움직인다.
 */
export function useViewport(handlers: GestureHandlers) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const h = useRef(handlers);
  h.current = handlers;
  const tween = useRef<{ stop: () => void } | null>(null);

  const apply = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const { x, y, k } = view.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
  }, []);

  const setView = useCallback((v: View) => {
    view.current = { x: v.x, y: v.y, k: Math.min(MAX_K, Math.max(MIN_K, v.k)) };
    apply();
  }, [apply]);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    const { x, y, k } = view.current;
    return { x: (cx - (r?.left ?? 0) - x) / k, y: (cy - (r?.top ?? 0) - y) / k };
  }, []);

  const flyTo = useCallback((target: View, opts?: { instant?: boolean }) => {
    tween.current?.stop();
    const from = { ...view.current };
    const to = { x: target.x, y: target.y, k: Math.min(MAX_K, Math.max(MIN_K, target.k)) };
    if (opts?.instant) return setView(to);
    tween.current = animate(0, 1, {
      type: 'spring', stiffness: 150, damping: 24, restDelta: 0.001,
      onUpdate: (t) => {
        view.current = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, k: from.k + (to.k - from.k) * t };
        apply();
      },
      onComplete: () => setView(to),
    });
  }, [apply, setView]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: 'none' | 'pending' | 'pan' | 'pinch' = 'none';
    let startPt = { x: 0, y: 0 };
    let startAt = 0;
    let startTarget: Element | null = null;
    let pressTimer: number | null = null;
    let pressed = false;
    let pinchPrev = { d: 0, cx: 0, cy: 0 };
    const SLOP = 8;

    const clearPress = () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = null;
      if (pressed) {
        pressed = false;
        h.current.onPressEnd?.();
      }
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target as Element;
      if (h.current.shouldIgnore?.(target)) return;
      tween.current?.stop();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);
      if (pointers.size === 1) {
        gesture = 'pending';
        startPt = { x: e.clientX, y: e.clientY };
        startAt = performance.now();
        startTarget = target;
        pressTimer = window.setTimeout(() => {
          pressTimer = null;
          if (gesture === 'pending' && startTarget) {
            pressed = true;
            h.current.onPressStart?.(startTarget, toWorld(startPt.x, startPt.y));
          }
        }, 120);
      } else if (pointers.size === 2) {
        clearPress();
        gesture = 'pinch';
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinchPrev = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      }
    };

    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (gesture === 'pending') {
        if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > SLOP) {
          clearPress();
          gesture = 'pan';
        } else return;
      }
      if (gesture === 'pan' && pointers.size === 1) {
        const v = view.current;
        setView({ ...v, x: v.x + dx, y: v.y + dy });
      } else if (gesture === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const r = el.getBoundingClientRect();
        const v = view.current;
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * (d / (pinchPrev.d || d))));
        const f = k / v.k;
        const ox = pinchPrev.cx - r.left, oy = pinchPrev.cy - r.top;
        setView({ k, x: cx - r.left - (ox - v.x) * f, y: cy - r.top - (oy - v.y) * f });
        pinchPrev = { d, cx, cy };
      }
    };

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      const wasPending = gesture === 'pending';
      const quick = performance.now() - startAt < 600;
      const wasPressed = pressed;
      clearPress();
      if (wasPending && pointers.size === 0 && (quick || wasPressed)) {
        const world = toWorld(e.clientX, e.clientY);
        h.current.onTap?.(e, world);
      }
      if (pointers.size === 0) gesture = 'none';
      else if (pointers.size === 1) {
        gesture = 'pan';
      }
    };

    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      clearPress();
      if (pointers.size === 0) gesture = 'none';
    };

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      tween.current?.stop();
      const r = el.getBoundingClientRect();
      const v = view.current;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      const f = k / v.k;
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      setView({ k, x: ox - (ox - v.x) * f, y: oy - (oy - v.y) * f });
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
      clearPress();
    };
  }, [setView, toWorld]);

  return { containerRef, contentRef, view, setView, flyTo, toWorld };
}
