import { useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GLOBE, pickShown, placeTopics, ringCapacity, ringLayout, type RingBox } from '../../core/layout/globe';
import { setDone } from '../../db/repo';
import type { Memo, Topic } from '../../db/schema';
import { CardFace, cardTilt } from '../MemoCard';
import { useBoardData } from '../useBoardData';
import { GlobeComposer } from './Composer';
import { MOTION, WRITE_MOCK } from './config';
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

/** 이름표를 화면 정가운데 둘 때 카드가 들어갈 화면 안 범위(입력 바 위까지) */
function ringBox(): RingBox {
  const w = window.innerWidth, h = window.innerHeight;
  const dockTop = document.querySelector('.dock')?.getBoundingClientRect().top ?? h - 110;
  return { left: -w / 2 + 8, right: w / 2 - 8, top: -h / 2 + MOTION.topPad, bottom: dockTop - MOTION.bottomPad - h / 2 };
}

/**
 * 지구본(천구) 보드 프로토타입(`?globe=1`). 주제가 화면 위아래 전체에 별처럼 흩어져 있고
 * 좌우로 돌리면 시선 높이가 다가오는 주제를 따라간다. 정가운데 가까운 주제일수록 이름표 둘레로 카드가 연속으로 펼쳐진다.
 * 회전은 GlobeEngine이 DOM에 직접 쓰고, React는 데이터·화면 크기가 바뀔 때만 다시 그린다.
 */
export function GlobeBoard({ onSelectMemo }: { onSelectMemo: (memoId: string | null) => void }) {
  const { topics, memos, links, layout, ready } = useBoardData();
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<GlobeEngine | null>(null);
  const els = useRef(new Map<string, { el: HTMLElement | null; tag: HTMLElement | null }>());
  const cardEls = useRef(new Map<string, HTMLElement | null>());
  const [box, setBox] = useState<RingBox>(() => ringBox());
  const [writing, setWriting] = useState(WRITE_MOCK);
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
              <div key={memo.id} className="g-card" data-memo-id={memo.id} ref={regCard(memo.id)} style={{ transform: `translate3d(${dx}px, ${dy}px, 0)` }}>
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
      {writing && <GlobeComposer onDismiss={() => setWriting(false)} />}
      {WRITE_MOCK && !writing && (
        <button type="button" className="g-pen" data-no-pan onClick={() => setWriting(true)}>
          새로 쓰기
        </button>
      )}
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={clusters.length} data-cards={memos.length} />
    </div>
  );
}
