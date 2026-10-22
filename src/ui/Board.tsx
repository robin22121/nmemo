import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hashUnit } from '../core/layout/seededRandom';
import { setDone } from '../db/repo';
import type { Memo, Topic } from '../db/schema';
import { motionBus, type Departure } from '../motion/bus';
import { arcKeyframes, FLIGHT_SECONDS, REORG_STAGGER, spring, wobbleOffset } from '../motion/presets';
import { GLOBE_ON } from './globe/config';
import { GlobeBoard } from './globe/GlobeBoard';
import { cardTilt, CardFace, MemoCard } from './MemoCard';
import { RelatedLines } from './RelatedLines';
import { useBoardData } from './useBoardData';
import { useViewport } from './viewport';
import './board.css';

export interface BoardProps {
  selectedMemoId: string | null;
  openClusterId: string | null;
  onSelectMemo: (memoId: string | null) => void;
  onOpenCluster: (topicId: string | null) => void;
  /** 끌어서 다른 무리에 놓음 */
  onMoveToTopic: (memoId: string, topicId: string) => void;
  /** 빈 곳에 놓음 → 새 주제 만들기 확인 */
  onMoveToNew: (memoId: string) => void;
  /** 알림(지구본 보드의 쓰기 칸이 씀) */
  notify?: (message: string) => void;
}

/** 무리 상세에서 카드가 펼쳐지는 배수 */
export const SPREAD = 1.6;

const DOCK_H = 150;

interface ClusterGlowProps { topic: Topic; x: number; y: number; r: number; appear: boolean; token?: number; spread: number; faded: boolean; accept: boolean }

function ClusterGlow({ topic, x, y, r, appear, token, spread, faded, accept }: ClusterGlowProps) {
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
      animate={{ x, y, opacity: faded ? 0.1 : 1 }}
      transition={{ ...spring.settle, opacity: { duration: 0.4 } }}
      style={{ ['--c' as string]: topic.color }}
    >
      <motion.div
        className="cluster-fx"
        initial={appear ? { scale: 0 } : { scale: spread }}
        animate={{ scale: accept ? spread * 1.08 : spread, transition: appear || accept ? spring.bouncy : spring.glide }}
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
        </motion.div>
      </motion.div>
    <motion.div
      className="cluster-label"
      data-cluster-label
      initial={{ x: '-50%', y: -r * spread + 6 }}
      animate={{ x: '-50%', y: -r * spread + 6 }}
      transition={spring.glide}
    >
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

/** 기본은 지구본 보드, `?globe=0`이면 기존 평면 보드 */
export function Board(props: BoardProps) {
  return GLOBE_ON ? <GlobeBoard onSelectMemo={props.onSelectMemo} onMoveToTopic={props.onMoveToTopic} notify={props.notify ?? (() => {})} /> : <FlatBoard {...props} />;
}

function FlatBoard({ selectedMemoId, openClusterId, onSelectMemo, onOpenCluster, onMoveToTopic, onMoveToNew }: BoardProps) {
  const { topics, memos, links, layout, ready } = useBoardData();
  const reduced = useReducedMotion();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const openRef = useRef(openClusterId);
  openRef.current = openClusterId;
  const memosRef = useRef(memos);
  memosRef.current = memos;
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const onTap = useCallback(
    (target: Element, world: { x: number; y: number }) => {
      if (target.closest('[data-todo-check]')) return;
      const card = target.closest('[data-memo-id]');
      if (card) return onSelectMemo(card.getAttribute('data-memo-id')!);
      if (openRef.current) return onSelectMemo(null);
      const label = target.closest('[data-topic-id]');
      if (label) return onOpenCluster(label.getAttribute('data-topic-id')!);
      const hit = clusterAt(world);
      if (hit) onOpenCluster(hit);
      else onSelectMemo(null);
    },
    [onSelectMemo, onOpenCluster],
  );

  /** 월드 좌표가 들어 있는 무리(가장 가까운 중심) */
  function clusterAt(world: { x: number; y: number }, except?: string): string | null {
    let best: { id: string; d: number } | null = null;
    for (const [id, c] of Object.entries(layoutRef.current.clusters)) {
      if (id === except) continue;
      const d = Math.hypot(world.x - c.x, world.y - c.y);
      if (d <= c.r && (!best || d < best.d)) best = { id, d };
    }
    return best?.id ?? null;
  }

  const { containerRef, contentRef, setView, flyTo, view } = useViewport({
    onTap,
    // 체크 박스·버튼은 자기 클릭 핸들러가 처리하게 둔다
    shouldIgnore: (t) => !!t.closest('[data-todo-check], [data-no-pan]'),
    onPressStart: (t) => {
      const id = t.closest('[data-memo-id]')?.getAttribute('data-memo-id');
      if (id) setPressedId(id);
    },
    onPressEnd: () => setPressedId(null),
    onLift: (t, world) => {
      const id = t.closest('[data-memo-id]')?.getAttribute('data-memo-id');
      if (!id || openRef.current) return false;
      const card = layoutRef.current.cards[id];
      if (!card) return false;
      navigator.vibrate?.(12);
      onSelectMemo(null);
      setDrag({ id, x: world.x, y: world.y, over: null });
      return true;
    },
    onDrag: (world) => {
      const d = dragRef.current;
      if (!d) return;
      const own = layoutRef.current.cards[d.id]?.topicId;
      setDrag({ id: d.id, x: world.x, y: world.y, over: clusterAt(world, own) });
    },
    onDrop: (world) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const own = layoutRef.current.cards[d.id]?.topicId;
      const over = clusterAt(world, own);
      if (over) return onMoveToTopic(d.id, over);
      if (clusterAt(world) === own) return; // 제자리로
      onMoveToNew(d.id);
    },
    onDragCancel: () => setDrag(null),
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
        } else if (m.type !== 'focusTopic') {
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

  // ---------- 관련 메모 강조 / 무리 상세 ----------
  const focusId = drag?.id ?? pressedId ?? selectedMemoId;
  const related = useMemo(() => {
    const m = new Map<string, number>();
    if (!focusId) return m;
    const present = new Set(memos.map((x) => x.id));
    for (const l of links) {
      const other = l.fromId === focusId ? l.toId : l.toId === focusId ? l.fromId : null;
      if (other && present.has(other)) m.set(other, Math.max(m.get(other) ?? 0, l.strength));
    }
    return m;
  }, [focusId, links, memos]);

  /** 무리 상세가 열려 있으면 그 무리 카드는 중심에서 바깥으로 펼쳐진다 */
  const posOf = useCallback(
    (id: string): { x: number; y: number; topicId: string } | null => {
      const p = layout.cards[id];
      if (!p) return null;
      if (openClusterId && p.topicId === openClusterId) {
        const c = layout.clusters[p.topicId];
        if (c) return { x: c.x + (p.x - c.x) * SPREAD, y: c.y + (p.y - c.y) * SPREAD, topicId: p.topicId };
      }
      return p;
    },
    [layout, openClusterId],
  );

  const pulls = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    if (!focusId || related.size === 0) return out;
    const f = posOf(focusId);
    if (!f) return out;
    for (const [id, strength] of related) {
      const p = posOf(id);
      if (!p) continue;
      const dx = f.x - p.x, dy = f.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const mag = Math.min(len * 0.4, 2 + 4 * strength);
      out.set(id, { x: (dx / len) * mag, y: (dy / len) * mag });
    }
    return out;
  }, [focusId, related, posOf]);

  const lineTargets = useMemo(() => {
    if (!focusId) return null;
    const f = posOf(focusId);
    if (!f) return null;
    const targets = [...related].flatMap(([id, strength]) => {
      const p = posOf(id);
      const pull = pulls.get(id);
      return p ? [{ id, strength, x: p.x + (pull?.x ?? 0), y: p.y + (pull?.y ?? 0) }] : [];
    });
    return { from: f, targets };
  }, [focusId, related, posOf, pulls]);

  // 무리 상세: 그 무리로 확대, 닫으면 원래 시야로
  const beforeOpen = useRef<{ x: number; y: number; k: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (openClusterId) {
      const c = layoutRef.current.clusters[openClusterId];
      if (!c) return;
      if (!beforeOpen.current) beforeOpen.current = { ...view.current };
      const cw = el.clientWidth, ch = el.clientHeight;
      const k = Math.min(1.15, Math.max(0.6, cw / (c.r * 2 * SPREAD * 0.82 + 40)));
      flyTo({ k, x: cw / 2 - c.x * k, y: ch * 0.42 - c.y * k });
    } else if (beforeOpen.current) {
      flyTo(beforeOpen.current);
      beforeOpen.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openClusterId]);

  // 상세가 열리면 그 카드가 시트 위쪽에 보이도록 시야를 옮긴다
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !selectedMemoId) return;
    const p = posOf(selectedMemoId);
    if (!p) return;
    const k = Math.max(view.current.k, 0.85);
    flyTo({ k, x: el.clientWidth / 2 - p.x * k, y: el.clientHeight * 0.24 - p.y * k });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemoId]);

  const cardEls = useMemo(
    () =>
      memos.map((m) => {
        const p = posOf(m.id);
        if (!p) return null;
        const base = layout.cards[m.id]!;
        const c = layout.clusters[p.topicId];
        const isFocus = m.id === focusId;
        const dragging = drag?.id === m.id;
        return (
          <MemoCard
            key={m.id}
            memo={m}
            x={p.x}
            y={p.y}
            focus={isFocus}
            glow={!!focusId && related.has(m.id)}
            dim={!!focusId && !isFocus && !related.has(m.id)}
            faded={!!openClusterId && base.topicId !== openClusterId}
            pull={pulls.get(m.id)}
            dragPos={dragging ? { x: drag!.x, y: drag!.y } : undefined}
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
    [memos, layout, popTokens, wobbleTokens, arcs, flights, onArcDone, posOf, focusId, related, pulls, drag, openClusterId],
  );

  return (
    <div className="board" ref={containerRef} data-testid="board">
      <div className="world" ref={contentRef}>
        {topics.map((t) => {
          const c = layout.clusters[t.id];
          return c ? (
            <ClusterGlow
              key={t.id}
              topic={t}
              x={c.x}
              y={c.y}
              r={c.r}
              appear={newTopicIds.has(t.id)}
              token={wobbleTokens[t.id]}
              spread={openClusterId === t.id ? SPREAD : 1}
              faded={!!openClusterId && openClusterId !== t.id}
              accept={drag?.over === t.id}
            />
          ) : null;
        })}
        {!drag && lineTargets && lineTargets.targets.length > 0 && <RelatedLines key={focusId} from={lineTargets.from} targets={lineTargets.targets} />}
        {cardEls}
      </div>
      <div className="flight-layer" aria-hidden>
        {flights.map((f) => (
          <FlightCard key={f.id} flight={f} onLand={onLand} />
        ))}
      </div>
      {memos.length > 0 && !openClusterId && (
        <button type="button" className="overview-btn" data-testid="overview-btn" data-no-pan onClick={toggleOverview}>
          {overview ? '돌아오기' : '전체 보기'}
        </button>
      )}
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={Object.keys(layout.clusters).length} data-cards={memos.length} />
    </div>
  );
}
