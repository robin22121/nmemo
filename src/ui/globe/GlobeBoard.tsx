import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GLOBE, pickShown, placeTopics, ringCapacity, ringLayout, type RingBox } from '../../core/layout/globe';
import { setDone } from '../../db/repo';
import type { Memo, Topic } from '../../db/schema';
import { motionBus } from '../../motion/bus';
import { arcKeyframes, FLIGHT_SECONDS } from '../../motion/presets';
import { getQueue } from '../../organize/runtime';
import { usePending } from '../hooks';
import { PenIcon } from '../icons';
import { CardFace, cardText, cardTilt } from '../MemoCard';
import { useBoardData } from '../useBoardData';
import { GlobeComposer } from './Composer';
import { MOTION, WRITE_START } from './config';
import { TopicListSheet } from './TopicListSheet';
import { GlobeEngine, type GlobeItem } from './engine';
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

/** 이름표를 화면 정가운데 둘 때 카드가 들어갈 화면 안 범위(아래 "새로 쓰기" 버튼 위까지) */
function ringBox(): RingBox {
  const w = window.innerWidth, h = window.innerHeight;
  return { left: -w / 2 + 8, right: w / 2 - 8, top: -h / 2 + MOTION.topPad, bottom: h / 2 - MOTION.bottomPad };
}

/** 정돈된 메모: 쓰기 칸 자리(대기 칩)에서 제 주제의 고리 칸으로 포물선 비행 */
interface Flight { id: string; memo: Memo; from: { x: number; y: number }; to: { x: number; y: number }; scale: number }

function FlightCard({ f, onLand }: { f: Flight; onLand: (f: Flight) => void }) {
  const kf = arcKeyframes(f.from, f.to, 150, 0.42);
  return (
    <motion.div
      className="flight-card"
      data-testid="flight-card"
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
 * 지구본(천구) 보드 프로토타입(`?globe=1`). 주제가 화면 위아래 전체에 별처럼 흩어져 있고
 * 좌우로 돌리면 시선 높이가 다가오는 주제를 따라간다. 정가운데 가까운 주제일수록 이름표 둘레로 카드가 연속으로 펼쳐진다.
 * 회전은 GlobeEngine이 DOM에 직접 쓰고, React는 데이터·화면 크기가 바뀔 때만 다시 그린다.
 */
export function GlobeBoard({ onSelectMemo, notify }: { onSelectMemo: (memoId: string | null) => void; notify: (m: string) => void }) {
  const { topics, memos, links, layout, ready } = useBoardData();
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<GlobeEngine | null>(null);
  const els = useRef(new Map<string, { el: HTMLElement | null; tag: HTMLElement | null }>());
  const cardEls = useRef(new Map<string, HTMLElement | null>());
  const [box, setBox] = useState<RingBox>(() => ringBox());
  const [writing, setWriting] = useState(WRITE_START);
  const [draft, setDraft] = useState('');
  const pending = usePending();
  // 정돈되어 날아올 메모: 제 칸에서는 숨겨 두었다가 비행이 끝나면 보인다
  const [incoming, setIncoming] = useState<Map<string, { topicId: string; from: { x: number; y: number } | null; at: number }>>(new Map());
  const [flights, setFlights] = useState<Flight[]>([]);
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const rotateTimer = useRef(0);
  const [listTopic, setListTopic] = useState<string | null>(null);
  const select = useRef(onSelectMemo);
  select.current = onSelectMemo;

  useEffect(() => {
    const on = () => setBox(ringBox());
    on(); // 입력 바가 그려진 뒤 다시 잰다
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
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
          // 이름표: 하늘 보기면 그 주제로 돌며 메모가 터져 나오고, 집중 보기면 그 주제로 돌아 집중
          if (!focus) e.focusTo(best.id);
          else if (best.id !== front) e.rotateTo(best.id);
          return;
        }
        // 빈 곳: 집중 → 하늘(메모가 이름표로 빨려 들어가고 다른 주제가 드러남), 하늘 → 가운데 주제에 다시 집중
        select.current(null);
        e.setFocus(!focus);
      },
      onSettle: (front) => settled.current(front),
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
      else if (hiddenAt && Date.now() - hiddenAt >= MOTION.writeAgainAfter) setWriting(true);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // 대기열이 메모를 정돈하면(App이 departure를 보냄) 날아올 메모로 등록. 출발점은 대기 칩(쓰기 칸이 있던 자리)
  useEffect(
    () =>
      motionBus.subscribe((m) => {
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
      fly.push({ id, memo, from: v.from ?? { x: window.innerWidth / 2, y: 90 }, to: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, scale: sc });
    }
    reveal(show);
    if (fly.length) setFlights((cur) => [...cur, ...fly]);
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
              <div key={memo.id} className={`g-card${incoming.has(memo.id) && !reduced ? ' g-incoming' : ''}`} data-memo-id={memo.id} ref={regCard(memo.id)} style={{ transform: `translate3d(${dx}px, ${dy}px, 0)` }}>
                <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(memo)}deg)` }}>
                  <CardFace memo={memo} onToggleDone={(mid, d) => void setDone(mid, d)} />
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
      </div>
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
      {writing ? (
        <GlobeComposer draft={draft} onDraft={setDraft} notify={notify} onSaved={() => closeComposer(true)} onDismiss={() => closeComposer(false)} />
      ) : (
        <button type="button" className="g-pen" data-no-pan data-testid="globe-write" onClick={() => setWriting(true)}>
          <PenIcon /> 새로 쓰기
        </button>
      )}
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={clusters.length} data-cards={memos.length} />
    </div>
  );
}
