import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hashUnit } from '../core/layout/seededRandom';
import { setDone } from '../db/repo';
import type { Memo, Topic } from '../db/schema';
import { motionBus, type Departure } from '../motion/bus';
import { arcKeyframes, FLIGHT_SECONDS, REORG_STAGGER, spring, wobbleOffset } from '../motion/presets';
import { cardTilt, CardFace, MemoCard } from './MemoCard';
import { useBoardData } from './useBoardData';
import { useViewport } from './viewport';
import './board.css';

export interface BoardProps {
  onOpenMemo?: (memoId: string) => void;
  onOpenCluster?: (topicId: string) => void;
}

const DOCK_H = 150;

interface ClusterGlowProps { topic: Topic; x: number; y: number; r: number; appear: boolean; token?: number }

function ClusterGlow({ topic, x, y, r, appear, token }: ClusterGlowProps) {
  const reduced = useReducedMotion();
  const fx = useAnimationControls();
  const a = hashUnit(topic.id, 'a');
  const b = hashUnit(topic.id, 'b');
  const size = r * 2.5;

  // 무리가 출렁: 카드가 도착하면 scale 1 → 1.03 → 1
  useEffect(() => {
    if (!token || reduced) return;
    void fx.start({ scale: [1, 1.03, 1], transition: { duration: 0.6, ease: 'easeOut' } });
  }, [token, reduced, fx]);

  return (
    <motion.div
      className="cluster"
      data-topic-id={topic.id}
      initial={{ x, y, opacity: appear ? 0 : 1 }}
      animate={{ x, y, opacity: 1 }}
      transition={{ ...spring.settle, opacity: { duration: 0.4 } }}
      style={{ ['--c' as string]: topic.color }}
    >
      <motion.div
        className="cluster-fx"
        initial={appear ? { scale: 0 } : false}
        animate={appear ? { scale: 1, transition: spring.bouncy } : undefined}
      >
        <motion.div animate={fx} className="cluster-fx">
          <div
            className="cluster-glow"
            style={{
              width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2,
              background: `radial-gradient(circle at ${50 + a * 8}% ${50 + b * 8}%, color-mix(in srgb, var(--c) 44%, transparent) 0%, color-mix(in srgb, var(--c) 26%, transparent) 30%, transparent 58%),
            radial-gradient(circle at ${50 - a * 14}% ${50 - b * 14}%, color-mix(in srgb, var(--c) 18%, transparent) 0%, transparent 42%)`,
            }}
          />
          <div className="cluster-label" style={{ top: -r + 6 }} data-cluster-label>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={topic.name}
                className="cluster-name"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.22 }}
              >
                {topic.name}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

interface Flight { id: string; memo: Memo; from: { x: number; y: number }; to: { x: number; y: number }; k: number; topicId: string }

function FlightCard({ flight, onLand }: { flight: Flight; onLand: (f: Flight) => void }) {
  const kf = arcKeyframes(flight.from, flight.to, 150, 0.42);
  return (
    <motion.div
      className="flight-card"
      initial={{ x: flight.from.x, y: flight.from.y, scale: 0.9 }}
      animate={{ x: kf.x, y: kf.y, scale: [0.9, 1.12, flight.k] }}
      transition={{
        x: { duration: FLIGHT_SECONDS, times: kf.times, ease: 'easeInOut' },
        y: { duration: FLIGHT_SECONDS, times: kf.times, ease: ['easeOut', 'easeIn'] },
        scale: { duration: FLIGHT_SECONDS, times: kf.times, ease: 'easeInOut' },
      }}
      onAnimationComplete={() => onLand(flight)}
      data-testid="flight-card"
    >
      <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(flight.memo)}deg)` }}>
        <CardFace memo={flight.memo} />
      </div>
    </motion.div>
  );
}

export function Board({ onOpenMemo, onOpenCluster }: BoardProps) {
  const { topics, memos, layout, ready } = useBoardData();
  const reduced = useReducedMotion();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const onTap = useCallback(
    (e: PointerEvent, world: { x: number; y: number }) => {
      const target = e.target as Element;
      if (target.closest('[data-todo-check]')) return;
      const card = target.closest('[data-memo-id]');
      if (card) return onOpenMemo?.(card.getAttribute('data-memo-id')!);
      const label = target.closest('[data-topic-id]');
      if (label) return onOpenCluster?.(label.getAttribute('data-topic-id')!);
      let best: { id: string; d: number } | null = null;
      for (const [id, c] of Object.entries(layoutRef.current.clusters)) {
        const d = Math.hypot(world.x - c.x, world.y - c.y);
        if (d <= c.r && (!best || d < best.d)) best = { id, d };
      }
      if (best) onOpenCluster?.(best.id);
    },
    [onOpenMemo, onOpenCluster],
  );

  const { containerRef, contentRef, setView, flyTo, view } = useViewport({
    onTap,
    // 체크 박스·버튼은 자기 클릭 핸들러가 처리하게 둔다
    shouldIgnore: (t) => !!t.closest('[data-todo-check], [data-no-pan]'),
  });

  /** 전체가 보이는 배율, 또는 읽기 좋은 기본 배율로 가운데 맞춤 */
  const framing = useCallback(
    (all: boolean) => {
      const el = containerRef.current!;
      const { bounds } = layoutRef.current;
      const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
      const cw = el.clientWidth, ch = el.clientHeight - DOCK_H;
      const fit = Math.min(cw / (bw + 60), ch / (bh + 60));
      const k = all ? Math.max(0.3, Math.min(1, fit)) : Math.min(1, Math.max(0.72, fit));
      const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
      return { k, x: cw / 2 - cx * k, y: ch / 2 - 10 - cy * k };
    },
    [containerRef],
  );

  // 처음 내용이 생겼을 때 한 번, 읽기 좋은 배율로 가운데에 맞춘다
  const fitted = useRef(false);
  useEffect(() => {
    if (!containerRef.current || fitted.current || !ready || memos.length === 0) return;
    setView(framing(false));
    fitted.current = true;
  }, [ready, memos.length, containerRef, setView, framing]);

  const [overview, setOverview] = useState(false);
  const saved = useRef<{ x: number; y: number; k: number } | null>(null);
  const toggleOverview = () => {
    if (!overview) {
      saved.current = { ...view.current };
      flyTo(framing(true));
    } else {
      flyTo(saved.current ?? framing(false));
    }
    setOverview(!overview);
  };

  // ---------- 움직임 연출 ----------
  // 처음 불러온 카드/무리는 조용히 놓이고, 그 뒤에 생긴 것만 피어난다.
  const seenCards = useRef<Set<string> | null>(null);
  const seenTopics = useRef<Set<string> | null>(null);
  if (ready && seenCards.current === null) {
    seenCards.current = new Set(memos.map((m) => m.id));
    seenTopics.current = new Set(topics.map((t) => t.id));
  }
  const initialized = seenCards.current !== null;
  const newCardIds = new Set<string>();
  const newTopicIds = new Set<string>();
  if (initialized) {
    for (const m of memos) if (!seenCards.current!.has(m.id)) newCardIds.add(m.id);
    for (const t of topics) if (!seenTopics.current!.has(t.id)) newTopicIds.add(t.id);
  }
  useEffect(() => {
    for (const id of newCardIds) seenCards.current?.add(id);
    for (const id of newTopicIds) seenTopics.current?.add(id);
  });

  const departures = useRef(new Map<string, Departure & { at: number }>());
  const [flights, setFlights] = useState<Flight[]>([]);
  const [popTokens, setPopTokens] = useState<Record<string, number>>({});
  const [wobbleTokens, setWobbleTokens] = useState<Record<string, number>>({});
  const [arcs, setArcs] = useState<Record<string, { from: { x: number; y: number }; delay: number }>>({});
  const pendingReorg = useRef<{ moved: string[]; at: number } | null>(null);
  const bumpWobble = useCallback((topicIds: string[]) => {
    setWobbleTokens((w) => {
      const n = { ...w };
      for (const t of topicIds) n[t] = (n[t] ?? 0) + 1;
      return n;
    });
  }, []);

  useEffect(
    () =>
      motionBus.subscribe((m) => {
        if (m.type === 'departure') {
          if (!reduced) departures.current.set(m.departure.memoId, { ...m.departure, at: Date.now() });
        } else {
          pendingReorg.current = { moved: m.outcome.moved.map((x) => x.memoId), at: Date.now() };
        }
      }),
    [reduced],
  );

  // 배치가 바뀔 때: 출발 대기 중인 카드는 비행 시작, 재구성으로 옮겨진 카드는 포물선 이동
  const lastCards = useRef(layout.cards);
  useEffect(() => {
    const byId = new Map(memos.map((m) => [m.id, m]));
    const el = containerRef.current;
    const v = view.current;
    const started: Flight[] = [];
    for (const [id, d] of departures.current) {
      const memo = byId.get(id);
      const pos = layout.cards[id];
      if (Date.now() - d.at > 8000) { departures.current.delete(id); continue; }
      if (!memo || !pos || !el) continue;
      const from = d.from ?? { x: el.clientWidth / 2, y: el.clientHeight - 90 };
      started.push({ id, memo, from, to: { x: v.x + pos.x * v.k, y: v.y + pos.y * v.k }, k: v.k, topicId: pos.topicId });
      departures.current.delete(id);
    }
    if (started.length) {
      for (const f of started) landing.current.set(f.id, f);
      setFlights((cur) => [...cur, ...started]);
    }

    const pr = pendingReorg.current;
    if (pr && Date.now() - pr.at < 15000 && !reduced) {
      const next: Record<string, { from: { x: number; y: number }; delay: number }> = {};
      let i = 0;
      for (const id of pr.moved) {
        const from = lastCards.current[id];
        const to = layout.cards[id];
        if (from && to && Math.hypot(from.x - to.x, from.y - to.y) > 20) next[id] = { from, delay: 0.35 + i++ * REORG_STAGGER };
      }
      if (i > 0) {
        setArcs((a) => ({ ...a, ...next }));
        pendingReorg.current = null;
        const involved = new Set(Object.keys(next).map((id) => layout.cards[id]!.topicId));
        window.setTimeout(() => bumpWobble([...involved]), (0.35 + i * REORG_STAGGER + 0.85) * 1000);
      }
    }
    lastCards.current = layout.cards;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, memos]);

  const landing = useRef(new Map<string, Flight>());
  const onLand = useCallback(
    (f: Flight) => {
      landing.current.delete(f.id);
      setFlights((cur) => cur.filter((x) => x.id !== f.id));
      setPopTokens((p) => ({ ...p, [f.id]: (p[f.id] ?? 0) + 1 }));
      bumpWobble([f.topicId]);
    },
    [bumpWobble],
  );
  const onArcDone = useCallback((id: string) => {
    setArcs((a) => {
      if (!a[id]) return a;
      const n = { ...a };
      delete n[id];
      return n;
    });
  }, []);

  const hiddenIds = new Set<string>([...departures.current.keys(), ...flights.map((f) => f.id)]);

  // 화면 밖 카드는 떠다니기를 멈춘다
  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.target as HTMLElement).classList.toggle('offscreen', !e.isIntersecting);
      },
      { root, rootMargin: '120px' },
    );
    root.querySelectorAll('.card-pos').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [memos, layout, containerRef]);

  const cardEls = useMemo(
    () =>
      memos.map((m) => {
        const p = layout.cards[m.id];
        if (!p) return null;
        const c = layout.clusters[p.topicId];
        return (
          <MemoCard
            key={m.id}
            memo={m}
            x={p.x}
            y={p.y}
            hidden={hiddenIds.has(m.id)}
            appear={newCardIds.has(m.id) && !hiddenIds.has(m.id)}
            popToken={popTokens[m.id]}
            wobbleToken={wobbleTokens[p.topicId]}
            wobble={c ? wobbleOffset(p, c) : undefined}
            arc={arcs[m.id]}
            onArcDone={onArcDone}
            onToggleDone={(id, d) => void setDone(id, d)}
          />
        );
      }),
    // hiddenIds/newCardIds는 렌더마다 새로 만들지만 아래 값들이 바뀔 때만 의미가 달라진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memos, layout, popTokens, wobbleTokens, arcs, flights, onArcDone],
  );

  return (
    <div className="board" ref={containerRef} data-testid="board">
      <div className="world" ref={contentRef}>
        {topics.map((t) => {
          const c = layout.clusters[t.id];
          return c ? (
            <ClusterGlow key={t.id} topic={t} x={c.x} y={c.y} r={c.r} appear={newTopicIds.has(t.id)} token={wobbleTokens[t.id]} />
          ) : null;
        })}
        {cardEls}
      </div>
      <div className="flight-layer" aria-hidden>
        {flights.map((f) => (
          <FlightCard key={f.id} flight={f} onLand={onLand} />
        ))}
      </div>
      {memos.length > 0 && (
        <button type="button" className="overview-btn" data-testid="overview-btn" data-no-pan onClick={toggleOverview}>
          {overview ? '돌아오기' : '전체 보기'}
        </button>
      )}
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={Object.keys(layout.clusters).length} data-cards={memos.length} />
    </div>
  );
}
