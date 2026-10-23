import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectedTopics, visibleMoves, type TopicConnection } from '../../core/connections';
import { archCapacity, archLayout, pickShown, placeTopics, splitGeom, type SplitGeom } from '../../core/layout/globe';
import { setDone } from '../../db/repo';
import { getDb } from '../../db/schema';
import type { Memo, Topic } from '../../db/schema';
import { motionBus } from '../../motion/bus';
import { arcKeyframes, FLIGHT_SECONDS } from '../../motion/presets';
import { getQueue } from '../../organize/runtime';
import { usePending } from '../hooks';
import { useObjectUrl } from '../hooks';
import { MovedIcon } from '../icons';
import { cardText } from '../MemoCard';
import { useBoardData } from '../useBoardData';
import { GlobeComposer } from './Composer';
import { GlobeMenu } from './GlobeMenu';
import { LABEL_STYLE, MOTION, WRITE_START } from './config';
import { TopicListSheet } from './TopicListSheet';
import { GlobeEngine, measureBoard, type GlobeItem } from './engine';
import '../board.css';
import './globe.css';

interface Cluster {
  topic: Topic;
  lambda: number;
  beta: number;
  /** 펼쳤을 때 보이는 거품: 아치 위 자리(제목 = 펼친 이름 중심 기준)와 줄(0 첫 줄 · 1 둘째 줄) */
  cards: { memo: Memo; rx: number; ry: number; row: number }[];
  /** 숨긴 수와 "+N" 거품 자리(넘칠 때만) */
  more: { n: number; rx: number; ry: number } | null;
  /** 거품 지름(px) */
  d: number;
  count: number;
}

/** 펼친 상태 배치(D37). 0 측정이면 null: 호출한 쪽이 이전 값을 지킨다 */
function splitOf(el?: HTMLElement | null, inset = 0, insetTop = 0): SplitGeom | null {
  const { w, h } = el ? measureBoard(el) : { w: window.innerWidth, h: window.innerHeight };
  return w && h ? splitGeom(w, h, MOTION.bottomPad + inset, insetTop) : null;
}

/** 정돈된 메모: 쓰기 칸 자리(대기 칩)에서 제 주제의 아치 자리로 포물선 비행 */
interface Flight { id: string; memo: Memo; color?: string; from: { x: number; y: number }; to: { x: number; y: number }; scale: number; d: number }

/** 길게 눌러 들어 올린 거품(D23). (x, y)는 손가락, (ox, oy)는 손가락 − 거품 중심, home은 원래 거품 중심 */
interface Lift { id: string; memo: Memo; from: string; color?: string; x: number; y: number; ox: number; oy: number; home: { x: number; y: number }; scale: number; d: number; over: string | null; armed: boolean; back?: boolean }

/** 거품 글 줄 수(D37): 첫 줄 아치 3줄, 둘째 줄 2줄 */
const ROW_LINES = [3, 2];

/**
 * 메모 거품(D37): 둥근 원 안에 글(내접 사각형 안, 12px, 줄 수 넘치면 말줄임). 할 일은 글 앞 ○(누르면 완료),
 * 사진은 거품 안 둥근 사진 + 한 줄. 겉은 face(메모 포커스가 이 원에서 커져 나온다)
 */
function Bubble({ memo, d, lines, onToggleDone }: { memo: Memo; d: number; lines: number; onToggleDone?: (id: string, done: boolean) => void }) {
  const photo = memo.input === 'photo';
  const url = useObjectUrl(photo ? memo.photo : undefined);
  const text = cardText(memo);
  const todo = memo.kind === 'todo' && !photo;
  return (
    <div
      className={`face bubble${memo.done && todo ? ' done' : ''}`}
      data-kind={photo ? 'photo' : memo.kind}
      style={{ width: d, height: d, ['--lines' as string]: photo ? 1 : lines, ['--in' as string]: `${Math.floor(d / Math.SQRT2)}px` }}
    >
      {photo && <span className="b-photo" style={url ? { backgroundImage: `url(${url})` } : undefined} />}
      <span className="face-text">
        {/* 한 덩어리로 감싼다: -webkit-box(말줄임)의 자식은 블록이 되어 ○가 따로 한 줄을 차지하므로.
            ○는 글자처럼 이어지는 인라인 span(button은 인라인 블록이라 그 뒤에서 줄이 바뀐다), 뒤에 낱말 잇개(U+2060):
            word-break keep-all에서 띄어쓰기 없는 긴 첫 낱말이 ○만 남기고 다음 줄로 넘어가지 않게 */}
        <span>
          {todo && (
            <span
              role="button"
              tabIndex={0}
              className="b-todo"
              aria-label={memo.done ? '완료 취소' : '완료'}
              aria-pressed={!!memo.done}
              data-todo-check
              onClick={(e) => {
                e.stopPropagation();
                onToggleDone?.(memo.id, !memo.done);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                e.stopPropagation();
                onToggleDone?.(memo.id, !memo.done);
              }}
            >
              {memo.done ? '✓' : '○'}
            </span>
          )}
          {todo && '\u2060'}
          {text}
        </span>
      </span>
    </div>
  );
}

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
      <div className="card" style={{ transform: 'translate(-50%, -50%)' }}>
        <Bubble memo={f.memo} d={f.d} lines={ROW_LINES[0]!} />
      </div>
    </motion.div>
  );
}

/**
 * 지구본 보드(앱의 보드 화면, D35). 화면 안에 통째로 보이는 작은 구 위에 주제가 점·이름표로 놓이고 구는 세로축으로만 돈다.
 * 주제를 누르면 위아래로 나뉜다(D37): 구는 아래로 내려가 작아지고, 그 주제 이름은 위쪽 제목 자리, 메모는 구 위 아치에 둥근 거품.
 * 회전은 GlobeEngine이 DOM에 직접 쓰고, React는 데이터·화면 크기가 바뀔 때만 다시 그린다.
 */
export function GlobeBoard({
  onSelectMemo,
  onMoveToTopic,
  notify,
  panelOpen = false,
}: {
  onSelectMemo: (memoId: string | null) => void;
  /** 들어 올린 카드를 다른 주제 이름에 놓음(평면 보드의 끌어 옮기기와 같은 처리 → 직접 정한 것으로 고정) */
  onMoveToTopic: (memoId: string, topicId: string) => void;
  notify: (m: string) => void;
  /** 메모 포커스가 열려 있음(+ 메뉴를 숨긴다). 자전은 멈추지 않는다(F5) */
  panelOpen?: boolean;
}) {
  const { topics, memos, links, layout, ready } = useBoardData();
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const insetRef = useRef<HTMLDivElement>(null);
  const engine = useRef<GlobeEngine | null>(null);
  const els = useRef(new Map<string, { el: HTMLElement | null; tag: HTMLElement | null; pt: HTMLElement | null }>());
  const cardEls = useRef(new Map<string, HTMLElement | null>());
  const [geom, setGeom] = useState<SplitGeom>(() => splitOf() ?? splitGeom(375, 812, MOTION.bottomPad));
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
    let raf = 0;
    const on = (tries = 0) => {
      cancelAnimationFrame(raf);
      // safe-area inset: 숨은 상자의 padding-bottom·top(env)을 읽는다(홈 표시줄·노치가 있는 기기만 0이 아님)
      const cs = getComputedStyle(insetRef.current!);
      const n = splitOf(rootRef.current, parseFloat(cs.paddingBottom) || 0, parseFloat(cs.paddingTop) || 0);
      if (!n) {
        // 0 측정(iOS 홈 화면 앱 콜드 스타트): 이전 값을 지키고 몇 프레임 뒤 다시 잰다
        if (tries < 60) raf = requestAnimationFrame(() => on(tries + 1));
        return;
      }
      setGeom((cur) => (n.w === cur.w && n.top === cur.top && n.globe.cy === cur.globe.cy && n.globe.r === cur.globe.r ? cur : n));
    };
    const onEvent = () => on();
    on();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onEvent);
    if (rootRef.current) ro?.observe(rootRef.current);
    window.addEventListener('resize', onEvent);
    window.visualViewport?.addEventListener('resize', onEvent);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', onEvent);
      window.visualViewport?.removeEventListener('resize', onEvent);
    };
  }, []);

  const clusters = useMemo<Cluster[]>(() => {
    const byId = new Map(memos.map((m) => [m.id, m]));
    const cap = archCapacity(geom);
    const place = placeTopics({
      topics: Object.keys(layout.clusters).map((id) => ({ id })),
      memos: Object.entries(layout.cards).map(([id, c]) => ({ id, topicId: c.topicId })),
      links: links.map((l) => ({ fromId: l.fromId, toId: l.toId, strength: l.strength })),
    });
    return topics.flatMap((topic) => {
      const pl = place.topics[topic.id];
      const c = layout.clusters[topic.id];
      if (!pl || !c) return [];
      // 펼치면 최근 K개만 오래된 것부터 아치 왼쪽 → 오른쪽(첫 줄, 다음 둘째 줄), 넘치는 만큼은 마지막 자리의 "+N" 거품으로(D18·D37)
      const local = Object.keys(layout.cards)
        .filter((id) => layout.cards[id]!.topicId === topic.id && byId.has(id))
        .map((id) => ({ id, createdAt: byId.get(id)!.createdAt, memo: byId.get(id)! }));
      const { shown, hidden } = pickShown(local, cap);
      const arch = archLayout(shown.length + (hidden ? 1 : 0), geom);
      const at = (i: number) => {
        const p = arch.pos[i]!;
        return { rx: Math.round(p.x - geom.title.x), ry: Math.round(p.y - geom.title.y), row: p.row };
      };
      const cards = shown.flatMap((l, i) => (arch.pos[i] ? [{ memo: l.memo, ...at(i) }] : []));
      const more = hidden && arch.pos[shown.length] ? { n: hidden, ...at(shown.length) } : null;
      return [{ topic, lambda: pl.lambda, beta: pl.beta, cards, more, d: arch.d, count: local.length }];
    });
  }, [topics, memos, links, layout, geom]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const e = new GlobeEngine(root, {
      shouldIgnore: (t) => !!t.closest('[data-todo-check], [data-no-pan]'),
      // 펼친 거품(+N 포함) 위에서 시작한 끌기는 구를 돌리지 않는다(D37). 거품은 펼친 주제에만 보인다
      holdOnly: (t) => !!t.closest('.g-card'),
      onTap: (t, x, y) => {
        const front = root.dataset.front;
        const focus = e.isFocus;
        const tid = t.closest('[data-topic-id]')?.getAttribute('data-topic-id');
        const card = t.closest('[data-memo-id]')?.getAttribute('data-memo-id');
        // 집중 보기: 펼친 주제의 거품 → 메모 상세, "+N" → 그 주제 메모 전체 목록. 주제를 바꾸는 중(D36 끄는 중간)에는 거품 탭 무효(D37)
        if (focus && (card || t.closest('[data-more]')) && tid === front && root.dataset.switching === '1') return;
        if (focus && card && tid === front) return select.current(card);
        if (focus && t.closest('[data-more]') && tid && tid === front) return setListTopic(tid);
        // 손가락에 가장 가까운 이름표(글자가 보이는 것만, 둘레 16px까지). 없으면 앞면 점(둘레 12px까지)
        let best: { id: string; d: number } | null = null;
        const near = (b: DOMRect) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
        for (const [id, r] of els.current) {
          const lod = r.el?.dataset.lod;
          if (lod !== 'label' && lod !== 'open') continue;
          const b = r.tag?.getBoundingClientRect();
          if (!b) continue;
          const d = near(b);
          if (d <= 16 && (!best || d < best.d)) best = { id, d };
        }
        if (!best)
          for (const [id, r] of els.current) {
            const b = r.el?.dataset.lod === 'dot' ? r.el.querySelector('.g-pt')?.getBoundingClientRect() : undefined;
            if (!b) continue;
            const d = near(b);
            if (d <= 12 && (!best || d < best.d)) best = { id, d };
          }
        if (best) {
          // 이름표: 하늘 보기면 그 주제가 떠올라 펼쳐지고, 집중 보기면 그 주제로 바꿔 펼침, 펼친 이름표면 메모가 접혀 구로(D29)
          if (!focus || best.id !== front) e.focusTo(best.id);
          else {
            select.current(null);
            e.setFocus(false);
          }
          return;
        }
        // 주제가 하나도 없으면 빈 곳 탭이 쓰기 창(집중할 주제가 없다)
        if (noTopics.current) {
          setWriteTo({ topicId: null, origin: { x, y } });
          setWriting(true);
          return;
        }
        // 빈 곳: 집중 → 하늘(메모가 이름표로 빨려 들어가고 다른 주제가 드러남, D29), 하늘 → 가운데 주제에 다시 집중
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
        return el ? [{ el, rx: k.rx, ry: k.ry }] : [];
      });
      // "+N" 거품도 다른 거품처럼 이름 자리에서 퍼져 나온다
      const chip = cardEls.current.get(`more:${c.topic.id}`);
      if (c.more && chip) cards.push({ el: chip, rx: c.more.rx, ry: c.more.ry });
      return [{ id: c.topic.id, lambda: c.lambda, beta: c.beta, el: r.el, tag: r.tag, pt: r.pt, cards, d: c.d, weight: c.count }];
    });
    engine.current?.setItems(items);
  }, [clusters]);

  useEffect(() => {
    engine.current?.setMode({ write: writing, reduced, paused: !!listTopic || !!lift || !!moving });
  }, [writing, reduced, listTopic, lift, moving]);

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
      const d = clusters.find((c) => c.topic.id === v.topicId)?.d ?? 76;
      fly.push({ id, memo, color: topics.find((t) => t.id === v.topicId)?.color, from: v.from ?? { x: window.innerWidth / 2, y: 90 }, to: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, scale: sc, d });
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

  /** 손가락 아래 주제 이름(위쪽 층의 이름 알약, 둘레 6px까지) */
  const overTopic = (x: number, y: number): string | null => {
    const list = moveListRef.current;
    if (!list) return null;
    for (const row of list.querySelectorAll<HTMLElement>('[data-move-topic]')) {
      const r = row.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return row.dataset.moveTopic ?? null;
    }
    return null;
  };

  const liftH = useRef<{ lift: (t: Element, x: number, y: number) => boolean; drag: (x: number, y: number) => void; drop: (x: number, y: number) => void }>({
    lift: () => false,
    drag: () => {},
    drop: () => {},
  });
  liftH.current = {
    // 집중 보기의 펼친 주제 거품만 들어 올린다(탭과 같은 범위, 주제 바꾸는 중 제외). 옮겨 갈 다른 주제가 있어야 한다
    lift: (t, x, y) => {
      const root = rootRef.current;
      if (!root || writing || !engine.current?.isFocus || root.dataset.switching === '1') return false;
      const el = t.closest<HTMLElement>('[data-memo-id]');
      const tid = t.closest('[data-topic-id]')?.getAttribute('data-topic-id');
      if (!el || !tid || tid !== root.dataset.front) return false;
      const memo = memos.find((m) => m.id === el.dataset.memoId);
      if (!memo?.topicId || !topics.some((tp) => tp.id !== memo.topicId)) return false;
      const b = (el.querySelector('.card') ?? el).getBoundingClientRect();
      const home = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      const scale = Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1);
      const d = clusters.find((c) => c.topic.id === tid)?.d ?? b.width;
      navigator.vibrate?.(12);
      select.current(null);
      setLift({ id: memo.id, memo, from: memo.topicId, color: topics.find((tp) => tp.id === memo.topicId)?.color, x, y, ox: x - home.x, oy: y - home.y, home, scale, d, over: null, armed: false });
      return true;
    },
    drag: (x, y) => {
      // 주제가 많아 층이 넘치면 아래 끝에 대고 있을 때 목록이 흐른다(위 끝은 처음으로)
      const list = moveListRef.current;
      if (list && list.scrollHeight > list.clientHeight) {
        const lr = list.getBoundingClientRect();
        if (y < lr.top + 28) list.scrollTop -= 8;
        else if (y > lr.bottom - 28 && y <= lr.bottom) list.scrollTop += 8;
      }
      // 들어 올린 자리에 이름이 덮여 있어도 손가락이 조금 움직이기 전에는 고르지 않는다(놓기만 해서 옮겨지지 않게)
      setLift((cur) => {
        if (!cur) return cur;
        const armed = cur.armed || Math.hypot(x - (cur.home.x + cur.ox), y - (cur.home.y + cur.oy)) > 12;
        return { ...cur, x, y, armed, over: armed ? overTopic(x, y) : null };
      });
    },
    drop: (x, y) => {
      const l = liftRef.current;
      if (!l) return;
      const over = l.armed || Math.hypot(x - (l.home.x + l.ox), y - (l.home.y + l.oy)) > 12 ? overTopic(x, y) : null;
      if (over && over !== l.from) {
        setLift(null);
        setMoving({ id: l.id, topicId: over, from: { x: x - l.ox, y: y - l.oy } });
        onMoveToTopic(l.id, over);
        return;
      }
      // 목록 밖: 취소, 거품은 제자리로 돌아간다
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

  const reg = (id: string, key: 'el' | 'tag' | 'pt') => (node: HTMLElement | null) => {
    const r = els.current.get(id) ?? { el: null, tag: null, pt: null };
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
      data-label={LABEL_STYLE}
    >
      <div ref={insetRef} className="g-inset" aria-hidden />
      <div className="g-stage">
        <div className="g-sphere" aria-hidden />
        {clusters.map((c) => (
          <div key={c.topic.id} className="g-cluster" data-topic-id={c.topic.id} ref={reg(c.topic.id, 'el')} style={{ ['--c' as string]: c.topic.color }}>
            {c.cards.map(({ memo, row }) => (
              <div
                key={memo.id}
                className={`g-card${incoming.has(memo.id) && !reduced ? ' g-incoming' : ''}${lift?.id === memo.id || moving?.id === memo.id ? ' g-lifted' : ''}`}
                data-memo-id={memo.id}
                data-row={row}
                ref={regCard(memo.id)}
                style={{ transform: 'translate3d(0px, 0px, 0)' }}
              >
                <div className="card" style={{ transform: 'translate(-50%, -50%)' }}>
                  <Bubble memo={memo} d={c.d} lines={ROW_LINES[row] ?? 2} onToggleDone={(mid, d) => void setDone(mid, d)} />
                  <CardMarks conn={conns.get(memo.id)} moved={moved.has(memo.id)} colorOf={colorOf} />
                </div>
              </div>
            ))}
            {c.more && (
              <div className="g-card g-more" data-more ref={regCard(`more:${c.topic.id}`)} style={{ transform: 'translate3d(0px, 0px, 0)' }}>
                <div className="card" style={{ transform: 'translate(-50%, -50%)' }}>
                  <div className="face bubble" style={{ width: c.d, height: c.d }}>
                    <span>+{c.more.n}</span>
                  </div>
                </div>
              </div>
            )}
            <i className="g-pt" ref={reg(c.topic.id, 'pt')} />
            <div className="g-tag" ref={reg(c.topic.id, 'tag')} data-topic-label>
              {c.topic.name}
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
            <div className="card" style={{ transform: 'translate(-50%, -50%)' }}>
              <Bubble memo={lift.memo} d={lift.d} lines={ROW_LINES[0]!} />
            </div>
          </div>
        )}
      </div>
      {lift && !lift.back && (
        // 위쪽 반투명 층(D37): 펼친 이름·거품 위를 덮고 다른 주제 이름을 늘어놓는다. 아래 끝 = 구 위 끝
        <div
          className={`g-move${topics.length > 12 ? ' compact' : ''}`}
          ref={moveListRef}
          data-testid="move-topics"
          aria-label="옮길 주제"
          style={{ height: Math.max(120, geom.globe.cy - geom.globe.r - 6) }}
        >
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
      {!writing && !lift && !panelOpen && (
        <GlobeMenu
          probe={() => ({ root: rootRef.current, engine: engine.current?.size })}
          tint={topics.find((t) => t.id === lastTopic)?.color}
          notify={notify}
          onWrite={(el) => openComposer(el, engine.current?.isFocus ? rootRef.current?.dataset.front ?? null : null)}
        />
      )}
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={clusters.length} data-cards={memos.length} />
    </div>
  );
}
