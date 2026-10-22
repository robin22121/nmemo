import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectedTopics, visibleMoves, type TopicConnection } from '../../core/connections';
import { GLOBE, pickShown, placeTopics, ringCapacity, ringLayout, type RingBox } from '../../core/layout/globe';
import { setDone } from '../../db/repo';
import { getDb } from '../../db/schema';
import type { Memo, Topic } from '../../db/schema';
import { motionBus } from '../../motion/bus';
import { arcKeyframes, FLIGHT_SECONDS } from '../../motion/presets';
import { getQueue } from '../../organize/runtime';
import { usePending } from '../hooks';
import { MovedIcon, PlusIcon } from '../icons';
import { CardFace, cardText, cardTilt } from '../MemoCard';
import { useBoardData } from '../useBoardData';
import { GlobeComposer } from './Composer';
import { MOTION, WRITE_START } from './config';
import { TopicListSheet } from './TopicListSheet';
import { GlobeEngine, type GlobeItem } from './engine';
import '../board.css';
import './globe.css';

interface Cluster {
  topic: Topic;
  lambda: number;
  beta: number;
  /** 펼쳤을 때 보이는 카드: 펼친 자리(r)와 접힌 점 자리(d), 이름표 중심 기준 */
  cards: { memo: Memo; rx: number; ry: number; dx: number; dy: number }[];
  /** 펼쳐도 숨는 메모의 점 자리(접혔을 때만 보임) */
  dots: { id: string; dx: number; dy: number }[];
  /** 숨긴 수와 "+N" 칩 자리(넘칠 때만) */
  more: { n: number; rx: number; ry: number } | null;
  k: number;
  count: number;
}

/** 이름표를 화면 정가운데 둘 때 카드가 들어갈 화면 안 범위(아래 여백 위까지). 보드 크기 기준 */
function ringBox(el?: HTMLElement | null): RingBox {
  const w = el?.clientWidth || window.innerWidth, h = el?.clientHeight || window.innerHeight;
  return { left: -w / 2 + 8, right: w / 2 - 8, top: -h / 2 + MOTION.topPad, bottom: h / 2 - MOTION.bottomPad };
}

/** 정돈된 메모: 쓰기 칸 자리(대기 칩)에서 제 주제의 고리 칸으로 포물선 비행 */
interface Flight { id: string; memo: Memo; color?: string; from: { x: number; y: number }; to: { x: number; y: number }; scale: number }

/** 길게 눌러 들어 올린 카드(D23). (x, y)는 손가락, (ox, oy)는 손가락 − 카드 중심, home은 원래 카드 중심 */
interface Lift { id: string; memo: Memo; from: string; color?: string; x: number; y: number; ox: number; oy: number; home: { x: number; y: number }; scale: number; over: string | null; back?: boolean }

/** 마지막으로 읽던 주제(= 마지막에 멈춘 정면 주제). 주제 없이 열린 쓰기 칸의 색. DB(데모)마다 따로 */
const lastTopicKey = () => `kk.lastTopic.${getDb().name}`;
function readLastTopic(): string | null {
  try {
    return localStorage.getItem(lastTopicKey());
  } catch {
    return null;
  }
}
function writeLastTopic(id: string) {
  try {
    localStorage.setItem(lastTopicKey(), id);
  } catch {
    // 저장소를 못 쓰면 이번 실행에서만 기억
  }
}

/** 카드 오른쪽 위의 작은 표시: 고정 메모가 이어진 다른 주제 색 점(D25, 3개까지 + "+N"), AI 이동 이력(D26) */
function CardMarks({ conn, moved, colorOf }: { conn?: TopicConnection[]; moved: boolean; colorOf: Map<string, string> }) {
  if (!conn?.length && !moved) return null;
  const shown = conn?.slice(0, 3) ?? [];
  const rest = (conn?.length ?? 0) - shown.length;
  return (
    <span className="g-marks" aria-hidden>
      {shown.length > 0 && (
        <span className="g-conn" data-testid="card-conn">
          {shown.map((c) => (
            <i key={c.topicId} data-conn-topic={c.topicId} style={{ ['--dc' as string]: colorOf.get(c.topicId) ?? '#c9c2b0' }} />
          ))}
          {rest > 0 && <b>+{rest}</b>}
        </span>
      )}
      {moved && (
        <span className="g-moved" data-testid="card-moved">
          <MovedIcon />
        </span>
      )}
    </span>
  );
}

function FlightCard({ f, onLand }: { f: Flight; onLand: (f: Flight) => void }) {
  const kf = arcKeyframes(f.from, f.to, 150, 0.42);
  return (
    <motion.div
      className="flight-card"
      data-testid="flight-card"
      style={f.color ? { ['--c' as string]: f.color } : undefined}
      initial={{ x: f.from.x, y: f.from.y, scale: 0.9 }}
      animate={{ x: kf.x, y: kf.y, scale: [0.9, 1.1, f.scale] }}
      transition={{
        x: { duration: FLIGHT_SECONDS, times: kf.times, ease: 'easeInOut' },
        y: { duration: FLIGHT_SECONDS, times: kf.times, ease: ['easeOut', 'easeIn'] },
        scale: { duration: FLIGHT_SECONDS, times: kf.times, ease: 'easeInOut' },
      }}
      onAnimationComplete={() => onLand(f)}
    >
      <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(f.memo)}deg)` }}>
        <CardFace memo={f.memo} />
      </div>
    </motion.div>
  );
}

/**
 * 지구본(천구) 보드(앱의 보드 화면). 주제가 화면 위아래 전체에 별처럼 흩어져 있고
 * 좌우로 돌리면 시선 높이가 다가오는 주제를 따라간다. 정가운데 가까운 주제일수록 이름표 둘레로 카드가 연속으로 펼쳐진다.
 * 회전은 GlobeEngine이 DOM에 직접 쓰고, React는 데이터·화면 크기가 바뀔 때만 다시 그린다.
 */
export function GlobeBoard({
  onSelectMemo,
  onMoveToTopic,
  notify,
}: {
  onSelectMemo: (memoId: string | null) => void;
  /** 들어 올린 카드를 다른 주제 이름에 놓음(평면 보드의 끌어 옮기기와 같은 처리 → 직접 정한 것으로 고정) */
  onMoveToTopic: (memoId: string, topicId: string) => void;
  notify: (m: string) => void;
}) {
  const { topics, memos, links, layout, ready } = useBoardData();
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<GlobeEngine | null>(null);
  const els = useRef(new Map<string, { el: HTMLElement | null; tag: HTMLElement | null }>());
  const cardEls = useRef(new Map<string, HTMLElement | null>());
  const [box, setBox] = useState<RingBox>(() => ringBox());
  const [writing, setWriting] = useState(WRITE_START);
  const [draft, setDraft] = useState('');
  // 쓰기 칸을 연 곳: 주제 옆 +면 그 주제, 그리고 열고 닫힐 때의 기준점(누른 버튼 중심)
  const [writeTo, setWriteTo] = useState<{ topicId: string | null; origin: { x: number; y: number } | null }>({ topicId: null, origin: null });
  const pending = usePending();
  // 연결 배지(D25)·이동 이력(D26): 보드 전체에서 한 번씩 읽고 맵으로 만들어 카드마다 찾아 쓴다
  const moves = useLiveQuery(() => getDb().moves.toArray(), [], []);
  const batches = useLiveQuery(() => getDb().batches.toArray(), [], []);
  const conns = useMemo(() => connectedTopics(memos, links), [memos, links]);
  const moved = useMemo(() => new Set(visibleMoves(moves, batches).map((m) => m.memoId)), [moves, batches]);
  const colorOf = useMemo(() => new Map(topics.map((t) => [t.id, t.color])), [topics]);
  // 정돈되어 날아올 메모: 제 칸에서는 숨겨 두었다가 비행이 끝나면 보인다
  const [incoming, setIncoming] = useState<Map<string, { topicId: string; from: { x: number; y: number } | null; at: number }>>(new Map());
  const [flights, setFlights] = useState<Flight[]>([]);
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const rotateTimer = useRef(0);
  const [listTopic, setListTopic] = useState<string | null>(null);
  const select = useRef(onSelectMemo);
  select.current = onSelectMemo;
  const [lastTopic, setLastTopic] = useState<string | null>(readLastTopic);
  // 주제가 하나도 없으면 빈 곳 탭으로 쓰기 칸을 연다(+가 없어 쓸 길이 없어지지 않게)
  const noTopics = useRef(true);
  noTopics.current = topics.length === 0;
  // 길게 눌러 주제 옮기기(D23): 들어 올린 카드, 그리고 옮긴 뒤 새 주제에 들어올 때까지 숨겨 둘 카드
  const [lift, setLift] = useState<Lift | null>(null);
  const liftRef = useRef(lift);
  liftRef.current = lift;
  const [moving, setMoving] = useState<{ id: string; topicId: string; from: { x: number; y: number } } | null>(null);
  const moveListRef = useRef<HTMLDivElement>(null);

  // 보드 자체 크기를 지켜본다. 인앱 브라우저(카카오톡 등)는 처음에 넓은 폭을 알렸다가 resize 이벤트 없이 줄어들기도 한다
  useEffect(() => {
    const on = () =>
      setBox((cur) => {
        const n = ringBox(rootRef.current);
        return n.left === cur.left && n.top === cur.top && n.bottom === cur.bottom ? cur : n;
      });
    on();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(on);
    if (rootRef.current) ro?.observe(rootRef.current);
    window.addEventListener('resize', on);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', on);
    };
  }, []);

  const clusters = useMemo<Cluster[]>(() => {
    const byId = new Map(memos.map((m) => [m.id, m]));
    const cap = ringCapacity(box);
    const place = placeTopics({
      topics: Object.keys(layout.clusters).map((id) => ({ id })),
      memos: Object.entries(layout.cards).map(([id, c]) => ({ id, topicId: c.topicId })),
      links: links.map((l) => ({ fromId: l.fromId, toId: l.toId, strength: l.strength })),
    });
    return topics.flatMap((topic) => {
      const pl = place.topics[topic.id];
      const c = layout.clusters[topic.id];
      if (!pl || !c) return [];
      // 점 구름은 기존 무리 배치를 줄여 쓴다. 펼치면 최근 K개만 오래된 것부터 이름표 둘레 시계방향(12시 시작),
      // 넘치는 만큼은 다음 칸의 "+N" 칩으로(D16·D18)
      const local = Object.entries(layout.cards)
        .filter(([id, p]) => p.topicId === topic.id && byId.has(id))
        .map(([id, p]) => ({ id, createdAt: byId.get(id)!.createdAt, memo: byId.get(id)!, dx: (p.x - c.x) * GLOBE.dotSpread, dy: (p.y - c.y) * GLOBE.dotSpread }));
      const { shown, hidden } = pickShown(local, cap);
      const ring = ringLayout(shown.length + (hidden ? 1 : 0), box);
      const cards = shown.map((l, i) => ({ memo: l.memo, dx: l.dx, dy: l.dy, rx: ring.pos[i]!.x, ry: ring.pos[i]!.y }));
      const shownIds = new Set(shown.map((l) => l.id));
      const dots = local.filter((l) => !shownIds.has(l.id)).map(({ id, dx, dy }) => ({ id, dx, dy }));
      const mp = ring.pos[shown.length];
      const more = hidden && mp ? { n: hidden, rx: mp.x, ry: mp.y } : null;
      return [{ topic, lambda: pl.lambda, beta: pl.beta, cards, dots, more, k: ring.k, count: local.length }];
    });
  }, [topics, memos, links, layout, box]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const e = new GlobeEngine(root, {
      shouldIgnore: (t) => !!t.closest('[data-todo-check], [data-no-pan]'),
      onTap: (t, x, y) => {
        const front = root.dataset.front;
        const focus = e.isFocus;
        const tid = t.closest('[data-topic-id]')?.getAttribute('data-topic-id');
        const card = t.closest('[data-memo-id]')?.getAttribute('data-memo-id');
        // 집중 보기: 가운데 주제의 카드 → 메모 상세, "+N" → 그 주제 메모 전체 목록
        if (focus && card && tid === front) return select.current(card);
        if (focus && t.closest('[data-more]') && tid && tid === front) return setListTopic(tid);
        // 손가락에 가장 가까운 이름표(뒷면 포함, 둘레 16px까지)
        let best: { id: string; d: number } | null = null;
        for (const [id, r] of els.current) {
          const b = r.tag?.getBoundingClientRect();
          if (!b) continue;
          const d = Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
          if (d <= 16 && (!best || d < best.d)) best = { id, d };
        }
        if (best) {
          // 이름표: 하늘 보기면 그 주제로 돌며 메모가 터져 나오고, 집중 보기면 그 주제로 돌아 집중, 정면 이름표면 메모가 접혀 하늘(D29)
          if (!focus) e.focusTo(best.id);
          else if (best.id !== front) e.rotateTo(best.id);
          else {
            select.current(null);
            e.setFocus(false);
          }
          return;
        }
        if (noTopics.current) {
          setWriteTo({ topicId: null, origin: { x, y } });
          setWriting(true);
          return;
        }
        // 빈 곳: 집중 → 하늘(메모가 이름표로 빨려 들어가고 다른 주제가 드러남), 하늘 → 가운데 주제에 다시 집중
        select.current(null);
        e.setFocus(!focus);
      },
      onSettle: (front) => settled.current(front),
      onLift: (t, x, y) => liftH.current.lift(t, x, y),
      onDrag: (x, y) => liftH.current.drag(x, y),
      onDrop: (x, y) => liftH.current.drop(x, y),
      onDragCancel: () => setLift(null),
    });
    engine.current = e;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    const items: GlobeItem[] = clusters.flatMap((c) => {
      const r = els.current.get(c.topic.id);
      if (!r?.el) return [];
      const cards = c.cards.flatMap((k) => {
        const el = cardEls.current.get(k.memo.id);
        return el ? [{ el, rx: k.rx, ry: k.ry, dx: k.dx, dy: k.dy }] : [];
      });
      // "+N" 칩도 카드처럼 이름표 자리에서 펼쳐져 나온다
      const chip = cardEls.current.get(`more:${c.topic.id}`);
      if (c.more && chip) cards.push({ el: chip, rx: c.more.rx, ry: c.more.ry, dx: 0, dy: 0 });
      return [{ id: c.topic.id, lambda: c.lambda, beta: c.beta, el: r.el, tag: r.tag, cards, k: c.k, weight: c.count }];
    });
    engine.current?.setItems(items);
  }, [clusters]);

  useEffect(() => {
    engine.current?.setMode({ write: writing, reduced });
  }, [writing, reduced]);

  // 백그라운드에 5분 넘게 있다 돌아오면 다시 쓰기 모드
  useEffect(() => {
    let hiddenAt = 0;
    const on = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= MOTION.writeAgainAfter) {
        setWriteTo({ topicId: null, origin: null });
        setWriting(true);
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // 대기열이 메모를 정돈하면(App이 departure를 보냄) 날아올 메모로 등록. 출발점은 대기 칩(쓰기 칸이 있던 자리)
  // 메모 상세에서 연결된 주제를 누르면(focusTopic) 그 주제로 돌아 집중한다
  useEffect(
    () =>
      motionBus.subscribe((m) => {
        if (m.type === 'focusTopic') return engine.current?.focusTo(m.topicId);
        if (m.type !== 'departure') return;
        const d = m.departure;
        setIncoming((cur) => new Map(cur).set(d.memoId, { topicId: d.topicId, from: d.from, at: Date.now() }));
      }),
    [],
  );

  const reveal = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setIncoming((cur) => {
      const n = new Map(cur);
      for (const id of ids) n.delete(id);
      return n;
    });
  }, []);

  // 날아올 메모가 배치에 들어오면 그 주제로 돈다. 연달아 들어오면 마지막 주제로 한 번만(mergeRotateMs)
  useEffect(() => {
    const placed = [...incoming.entries()].filter(([id]) => cardEls.current.get(id));
    if (!placed.length) return;
    window.clearTimeout(rotateTimer.current);
    rotateTimer.current = window.setTimeout(() => {
      const last = placed.reduce((b, x) => (x[1].at > b[1].at ? x : b));
      if (reduced) reveal(placed.map(([id]) => id));
      engine.current?.focusTo(last[1].topicId);
    }, MOTION.mergeRotateMs);
    // 6초 안에 못 날면 그냥 보인다(유실 방지)
    const t = window.setTimeout(() => reveal(placed.map(([id]) => id)), 6000);
    return () => window.clearTimeout(t);
  }, [incoming, clusters, reduced, reveal]);

  // 회전이 멈추면: 정가운데 주제로 들어올 메모는 대기 칩 자리에서 제 칸으로 날고, 다른 주제 것은 그냥 보인다
  const settled = useRef<(front: string | null) => void>(() => {});
  settled.current = (front) => {
    if (front && !writing && front !== lastTopic) {
      setLastTopic(front);
      writeLastTopic(front);
    }
    const ready = [...incomingRef.current.entries()].filter(([id]) => cardEls.current.get(id));
    if (!ready.length || reduced) return;
    const fly: Flight[] = [];
    const show: string[] = [];
    for (const [id, v] of ready) {
      if (flights.some((f) => f.id === id)) continue;
      const el = cardEls.current.get(id)!;
      const memo = memos.find((m) => m.id === id);
      if (v.topicId !== front || !memo) {
        show.push(id);
        continue;
      }
      const r = el.getBoundingClientRect();
      const sc = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
      fly.push({ id, memo, color: topics.find((t) => t.id === v.topicId)?.color, from: v.from ?? { x: window.innerWidth / 2, y: 90 }, to: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, scale: sc });
    }
    reveal(show);
    if (fly.length) setFlights((cur) => [...cur, ...fly]);
  };

  // 옮긴 메모가 새 주제에 들어오면 놓은 자리에서 제 칸으로 날아온다(정돈 비행을 그대로 쓴다)
  useEffect(() => {
    if (!moving) return;
    if (memos.find((m) => m.id === moving.id)?.topicId === moving.topicId) {
      // 새 주제 고리가 차서 점으로만 들어가면 날 칸이 없으니 그 주제로 돌기만 한다
      if (cardEls.current.get(moving.id)) setIncoming((cur) => new Map(cur).set(moving.id, { topicId: moving.topicId, from: moving.from, at: Date.now() }));
      else engine.current?.focusTo(moving.topicId);
      setMoving(null);
      return;
    }
    const t = window.setTimeout(() => setMoving(null), 3000);
    return () => window.clearTimeout(t);
  }, [moving, memos]);

  /** 손가락 아래 주제 이름(오른쪽 위 목록). 이름이 짧아도 목록 폭 안이면 그 줄로 본다 */
  const overTopic = (x: number, y: number): string | null => {
    const list = moveListRef.current;
    if (!list) return null;
    const lr = list.getBoundingClientRect();
    if (x < lr.left - 16 || y < lr.top || y > lr.bottom) return null;
    for (const row of list.querySelectorAll<HTMLElement>('[data-move-topic]')) {
      const r = row.getBoundingClientRect();
      if (y >= r.top - 3 && y <= r.bottom + 3) return row.dataset.moveTopic ?? null;
    }
    return null;
  };

  const liftH = useRef<{ lift: (t: Element, x: number, y: number) => boolean; drag: (x: number, y: number) => void; drop: (x: number, y: number) => void }>({
    lift: () => false,
    drag: () => {},
    drop: () => {},
  });
  liftH.current = {
    // 집중 보기의 가운데 주제 카드만 들어 올린다(탭과 같은 범위). 옮겨 갈 다른 주제가 있어야 한다
    lift: (t, x, y) => {
      const root = rootRef.current;
      if (!root || writing || !engine.current?.isFocus) return false;
      const el = t.closest<HTMLElement>('[data-memo-id]');
      const tid = t.closest('[data-topic-id]')?.getAttribute('data-topic-id');
      if (!el || !tid || tid !== root.dataset.front) return false;
      const memo = memos.find((m) => m.id === el.dataset.memoId);
      if (!memo?.topicId || !topics.some((tp) => tp.id !== memo.topicId)) return false;
      const b = (el.querySelector('.card') ?? el).getBoundingClientRect();
      const home = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const scale = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
      navigator.vibrate?.(12);
      select.current(null);
      setLift({ id: memo.id, memo, from: memo.topicId, color: topics.find((tp) => tp.id === memo.topicId)?.color, x, y, ox: x - home.x, oy: y - home.y, home, scale, over: null });
      return true;
    },
    drag: (x, y) => {
      // 주제가 많아 목록이 넘치면 위아래 끝에 대고 있을 때 목록이 흐른다
      const list = moveListRef.current;
      if (list && list.scrollHeight > list.clientHeight) {
        const lr = list.getBoundingClientRect();
        if (x >= lr.left - 16 && y < lr.top + 28) list.scrollTop -= 8;
        else if (x >= lr.left - 16 && y > lr.bottom - 28) list.scrollTop += 8;
      }
      const over = overTopic(x, y);
      setLift((cur) => (cur ? { ...cur, x, y, over } : cur));
    },
    drop: (x, y) => {
      const l = liftRef.current;
      if (!l) return;
      const over = overTopic(x, y);
      if (over && over !== l.from) {
        setLift(null);
        setMoving({ id: l.id, topicId: over, from: { x: x - l.ox, y: y - l.oy } });
        onMoveToTopic(l.id, over);
        return;
      }
      // 목록 밖: 취소, 카드는 제자리로 돌아간다
      if (reduced) return setLift(null);
      setLift({ ...l, x: l.home.x + l.ox, y: l.home.y + l.oy, over: null, back: true });
      window.setTimeout(() => setLift((cur) => (cur?.id === l.id && cur.back ? null : cur)), 400);
    },
  };

  const onLand = useCallback(
    (f: Flight) => {
      setFlights((cur) => cur.filter((x) => x.id !== f.id));
      reveal([f.id]);
      // 착지 팝: 살짝 부풀었다 돌아온다
      const card = cardEls.current.get(f.id)?.querySelector<HTMLElement>('.card');
      if (card) {
        const base = card.style.transform;
        card.animate([{ transform: `${base} scale(1.18)` }, { transform: base }], { duration: 380, easing: 'cubic-bezier(.2,1.5,.4,1)' });
      }
    },
    [reveal],
  );

  const openComposer = (el: HTMLElement, topicId: string | null) => {
    const b = el.getBoundingClientRect();
    setWriteTo({ topicId, origin: { x: b.left + b.width / 2, y: b.top + b.height / 2 } });
    setWriting(true);
  };

  const closeComposer = (saved: boolean) => {
    setWriting(false);
    if (saved) engine.current?.setFocus(true);
  };

  const reg = (id: string, key: 'el' | 'tag') => (node: HTMLElement | null) => {
    const r = els.current.get(id) ?? { el: null, tag: null };
    r[key] = node;
    els.current.set(id, r);
  };
  const regCard = (id: string) => (node: HTMLElement | null) => {
    cardEls.current.set(id, node);
  };

  return (
    <div
      className="board g-board"
      ref={rootRef}
      data-testid="board"
      data-write={writing ? '1' : undefined}
      data-blur={writing && MOTION.composerBlur ? '1' : undefined}
    >
      <div className="g-stage">
        {clusters.map((c) => (
          <div key={c.topic.id} className="g-cluster" data-topic-id={c.topic.id} ref={reg(c.topic.id, 'el')} style={{ ['--c' as string]: c.topic.color }}>
            <div className="g-glow" />
            {c.cards.map(({ memo, dx, dy }) => (
              <div
                key={memo.id}
                className={`g-card${incoming.has(memo.id) && !reduced ? ' g-incoming' : ''}${lift?.id === memo.id || moving?.id === memo.id ? ' g-lifted' : ''}`}
                data-memo-id={memo.id}
                ref={regCard(memo.id)}
                style={{ transform: `translate3d(${dx}px, ${dy}px, 0)` }}
              >
                <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(memo)}deg)` }}>
                  <CardFace memo={memo} onToggleDone={(mid, d) => void setDone(mid, d)} />
                  <CardMarks conn={conns.get(memo.id)} moved={moved.has(memo.id)} colorOf={colorOf} />
                </div>
                <i className="g-dot" />
              </div>
            ))}
            {c.dots.map(({ id, dx, dy }) => (
              <i key={id} className="g-dot g-dot-only" style={{ transform: `translate3d(${dx}px, ${dy}px, 0)` }} />
            ))}
            {c.more && (
              <div className="g-card g-more" data-more ref={regCard(`more:${c.topic.id}`)} style={{ transform: 'translate3d(0, 0, 0)' }}>
                <span>+{c.more.n}</span>
              </div>
            )}
            <div className="g-tag" ref={reg(c.topic.id, 'tag')} data-topic-label>
              {c.topic.name}
              {/* 펼친(정가운데) 주제에만 보인다. 누르면 이 자리에서 쓰기 칸이 커지며 열리고, 쓴 메모는 이 주제에 붙는다 */}
              <button
                type="button"
                className="g-tag-plus"
                data-no-pan
                data-testid="topic-plus"
                aria-label={`${c.topic.name}에 메모 쓰기`}
                onClick={(e) => openComposer(e.currentTarget, c.topic.id)}
              >
                <PlusIcon />
              </button>
            </div>
          </div>
        ))}
      </div>
      <TopicListSheet
        topic={topics.find((t) => t.id === listTopic) ?? null}
        memos={listTopic ? memos.filter((m) => m.topicId === listTopic) : []}
        onClose={() => setListTopic(null)}
        onPick={(id) => {
          setListTopic(null);
          select.current(id);
        }}
      />
      <div className="g-flights" aria-hidden>
        {flights.map((f) => (
          <FlightCard key={f.id} f={f} onLand={onLand} />
        ))}
        {lift && (
          <div
            className="g-lift"
            data-testid="lift-card"
            data-return={lift.back ? '1' : undefined}
            style={{
              ...(lift.color ? { ['--c' as string]: lift.color } : {}),
              transform: `translate3d(${(lift.x - lift.ox).toFixed(1)}px, ${(lift.y - lift.oy).toFixed(1)}px, 0) scale(${(lift.scale * (lift.back ? 1 : 1.08)).toFixed(3)})`,
            }}
            onTransitionEnd={() => setLift((cur) => (cur?.back ? null : cur))}
          >
            <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(lift.memo)}deg)` }}>
              <CardFace memo={lift.memo} />
            </div>
          </div>
        )}
      </div>
      {lift && !lift.back && (
        <div className={`g-move${topics.length > 9 ? ' compact' : ''}`} ref={moveListRef} data-testid="move-topics" aria-label="옮길 주제">
          {topics
            .filter((t) => t.id !== lift.from)
            .map((t) => (
              <div key={t.id} className={`g-move-row${lift.over === t.id ? ' over' : ''}`} data-move-topic={t.id} style={{ ['--c' as string]: t.color }}>
                <i />
                <span>{t.name}</span>
              </div>
            ))}
        </div>
      )}
      {!writing && pending.length > 0 && (
        <div className="g-pending" data-no-pan>
          {pending.map((m) => (
            <button
              type="button"
              key={m.id}
              className={`g-pchip${m.status === 'failed' ? ' failed' : ''}`}
              data-testid="pending-card"
              data-pending-id={m.id}
              onClick={m.status === 'failed' ? () => void getQueue().retry(m.id) : undefined}
            >
              {m.status === 'failed' ? '다시 시도 · ' : ''}
              {cardText(m)}
            </button>
          ))}
        </div>
      )}
      <AnimatePresence>
        {writing && (
          <GlobeComposer
            key="composer"
            draft={draft}
            onDraft={setDraft}
            notify={notify}
            topic={topics.find((t) => t.id === writeTo.topicId) ?? null}
            tint={topics.find((t) => t.id === lastTopic)?.color}
            origin={writeTo.origin}
            onSaved={() => closeComposer(true)}
            onDismiss={() => closeComposer(false)}
          />
        )}
      </AnimatePresence>
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={clusters.length} data-cards={memos.length} />
    </div>
  );
}
