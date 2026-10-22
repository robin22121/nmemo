import { useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fitClusterCards, GLOBE, placeTopics } from '../../core/layout/globe';
import { setDone } from '../../db/repo';
import type { Memo, Topic } from '../../db/schema';
import { CardFace, cardText, cardTilt } from '../MemoCard';
import { useBoardData } from '../useBoardData';
import { GlobeComposer } from './Composer';
import { MOTION, VARIANT, WRITE_MOCK } from './config';
import { GlobeEngine, type GlobeItem } from './engine';
import './globe.css';

interface Cluster {
  topic: Topic;
  lambda: number;
  beta: number;
  /** 지구본용으로 맞춘 카드 로컬 좌표(가운데에서 가까운 순) */
  cards: { memo: Memo; x: number; y: number }[];
  top: number;
  bottom: number;
}

const LABEL_H = 34;

/**
 * 지구본 보드 프로토타입(`?globe=1`). 주제가 세로축을 중심으로 돈다.
 * 회전은 GlobeEngine이 DOM에 직접 쓰고, React는 데이터·모드가 바뀔 때만 다시 그린다.
 */
export function GlobeBoard({ onSelectMemo }: { onSelectMemo: (memoId: string | null) => void }) {
  const { topics, memos, links, layout, ready } = useBoardData();
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const engine = useRef<GlobeEngine | null>(null);
  const els = useRef(new Map<string, { el: HTMLElement | null; body: HTMLElement | null; tag: HTMLElement | null }>());
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [overview, setOverview] = useState(false);
  const [writing, setWriting] = useState(WRITE_MOCK);
  const [panelId, setPanelId] = useState<string | null>(null);
  const select = useRef(onSelectMemo);
  select.current = onSelectMemo;

  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const clusters = useMemo<Cluster[]>(() => {
    const byId = new Map(memos.map((m) => [m.id, m]));
    const place = placeTopics({
      topics: Object.keys(layout.clusters).map((id) => ({ id })),
      memos: Object.entries(layout.cards).map(([id, c]) => ({ id, topicId: c.topicId })),
      links: links.map((l) => ({ fromId: l.fromId, toId: l.toId, strength: l.strength })),
    });
    const maxHalfW = width / 2 - GLOBE.cardW / 2 - 8;
    return topics.flatMap((topic) => {
      const pl = place.topics[topic.id];
      const c = layout.clusters[topic.id];
      if (!pl || !c) return [];
      const local = Object.entries(layout.cards)
        .filter(([, p]) => p.topicId === topic.id)
        .map(([id, p]) => ({ id, x: p.x - c.x, y: p.y - c.y }));
      const cards = fitClusterCards(local, maxHalfW)
        .flatMap((p) => (byId.has(p.id) ? [{ memo: byId.get(p.id)!, x: p.x, y: p.y }] : []))
        .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
      const ys = cards.map((k) => k.y);
      const top = Math.min(0, ...ys) - GLOBE.cardH / 2 - LABEL_H;
      const bottom = Math.max(0, ...ys) + GLOBE.cardH / 2 + 8;
      return [{ topic, lambda: pl.lambda, beta: pl.beta, cards, top, bottom }];
    });
  }, [topics, memos, links, layout, width]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const e = new GlobeEngine(root, {
      shouldIgnore: (t) => !!t.closest('[data-todo-check], [data-no-pan]'),
      onTap: (t) => {
        const tid = t.closest('[data-topic-id]')?.getAttribute('data-topic-id');
        const front = root.dataset.front;
        const card = t.closest('[data-memo-id]')?.getAttribute('data-memo-id');
        if (root.dataset.overview === '1' && tid) {
          setOverview(false);
          e.rotateTo(tid);
        } else if (card && (!tid || tid === front)) select.current(card);
        else if (tid && tid !== front) e.rotateTo(tid);
        else select.current(null);
      },
      onSettle: (id) => {
        if (VARIANT === 'b') setPanelId(id);
      },
      onMoveStart: () => {
        if (VARIANT === 'b') setPanelId(null);
      },
      onPinch: (out) => setOverview(out),
      scrollTarget:
        VARIANT === 'b'
          ? () => {
              const p = panelRef.current;
              const body = p?.firstElementChild as HTMLElement | null;
              if (!p || !body) return null;
              return { el: body, min: Math.min(0, p.clientHeight - body.scrollHeight - 16), max: 0 };
            }
          : undefined,
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
      return [{
        id: c.topic.id, lambda: c.lambda, beta: c.beta, el: r.el, body: r.body, tag: r.tag,
        top: c.top, bottom: c.bottom, tagFit: VARIANT === 'a' ? 0.85 : 0.55, big: VARIANT === 'a' && c.cards.length > MOTION.bigTopic, weight: c.cards.length,
      }];
    });
    engine.current?.setItems(items);
  }, [clusters]);

  useEffect(() => {
    engine.current?.setMode({ write: writing, overview, reduced });
    if (rootRef.current) rootRef.current.dataset.overview = overview ? '1' : '0';
  }, [writing, overview, reduced]);

  useEffect(() => engine.current?.resetScroll(), [panelId]);

  const reg = (id: string, key: 'el' | 'body' | 'tag') => (node: HTMLElement | null) => {
    const r = els.current.get(id) ?? { el: null, body: null, tag: null };
    r[key] = node;
    els.current.set(id, r);
  };

  const panel = VARIANT === 'b' && panelId && !overview && !writing ? clusters.find((c) => c.topic.id === panelId) : undefined;

  return (
    <div
      className="board g-board"
      ref={rootRef}
      data-testid="board"
      data-variant={VARIANT}
      data-write={writing ? '1' : undefined}
      data-blur={writing && MOTION.composerBlur ? '1' : undefined}
    >
      <div className="g-stage">
        {clusters.map((c) =>
          VARIANT === 'a' ? (
            <ClusterA key={c.topic.id} c={c} reg={reg} />
          ) : (
            <TileB key={c.topic.id} c={c} reg={reg} open={!!panel && panel.topic.id === c.topic.id} />
          ),
        )}
      </div>
      {panel && (
        <div className="g-panel" ref={panelRef} key={panel.topic.id} style={{ ['--c' as string]: panel.topic.color }}>
          <div className="g-panel-body">
            <div className="g-panel-name">{panel.topic.name}<span>{panel.cards.length}</span></div>
            <div className="g-panel-cards">
              {panel.cards.map(({ memo }) => (
                <div key={memo.id} className="g-pcard" data-memo-id={memo.id} data-topic-id={panel.topic.id}>
                  <div className="card" style={{ transform: `rotate(${cardTilt(memo) * 0.5}deg)` }}>
                    <CardFace memo={memo} onToggleDone={(id, d) => void setDone(id, d)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {memos.length > 0 && !writing && (
        <button type="button" className="overview-btn" data-testid="overview-btn" data-no-pan onClick={() => setOverview(!overview)}>
          {overview ? '돌아오기' : '전체'}
        </button>
      )}
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

type Reg = (id: string, key: 'el' | 'body' | 'tag') => (node: HTMLElement | null) => void;

/** A안: 무리 전체가 카드째 돈다. 세부 단계(data-lod)는 엔진이 바꾸고 CSS가 보이기만 바꾼다 */
function ClusterA({ c, reg }: { c: Cluster; reg: Reg }) {
  const id = c.topic.id;
  const extra = c.cards.length - MOTION.bigPreview;
  return (
    <div className="g-cluster" data-topic-id={id} ref={reg(id, 'el')} style={{ ['--c' as string]: c.topic.color }}>
      <div className="g-glow" style={{ width: (c.bottom - c.top) * 1.4, height: (c.bottom - c.top) * 1.4 }} />
      <div className="g-body" ref={reg(id, 'body')}>
        <div className="g-label" data-topic-label style={{ transform: `translate(-50%, ${c.top}px)` }}>
          {c.topic.name}
        </div>
        {c.cards.map(({ memo, x, y }, i) => (
          <div
            key={memo.id}
            className="g-card"
            data-memo-id={memo.id}
            data-extra={i >= MOTION.bigPreview ? '1' : undefined}
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <div className="card" style={{ transform: `translate(-50%, -50%) rotate(${cardTilt(memo)}deg)` }}>
              <CardFace memo={memo} onToggleDone={(mid, d) => void setDone(mid, d)} />
            </div>
          </div>
        ))}
        {extra > 0 && <div className="g-more">+{extra}</div>}
      </div>
      <div className="g-dots" aria-hidden>
        {c.cards.map(({ memo, x, y }) => (
          <i key={memo.id} style={{ transform: `translate(${x * 0.5}px, ${y * 0.5}px)` }} />
        ))}
      </div>
      <div className="g-tag" ref={reg(id, 'tag')} data-topic-label>
        {c.topic.name}
      </div>
    </div>
  );
}

/** B안: 링에는 가벼운 주제 타일만. 멈춘 정면 주제는 타일 대신 평면 판(g-panel)이 펼쳐진다 */
function TileB({ c, reg, open }: { c: Cluster; reg: Reg; open: boolean }) {
  const id = c.topic.id;
  const preview = [...c.cards].sort((a, b) => b.memo.createdAt - a.memo.createdAt).slice(0, 3);
  return (
    <div className={`g-cluster g-tilewrap${open ? ' open' : ''}`} data-topic-id={id} ref={reg(id, 'el')} style={{ ['--c' as string]: c.topic.color }}>
      <div className="g-tile" ref={reg(id, 'tag')}>
        <div className="g-tile-name" data-topic-label>
          {c.topic.name}
          <span>{c.cards.length}</span>
        </div>
        <ul>
          {preview.map(({ memo }) => (
            <li key={memo.id}>{cardText(memo)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
