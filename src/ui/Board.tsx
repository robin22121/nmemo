import { useCallback, useEffect, useRef, useState } from 'react';
import { hashUnit } from '../core/layout/seededRandom';
import { setDone } from '../db/repo';
import type { Topic } from '../db/schema';
import { MemoCard } from './MemoCard';
import { useBoardData } from './useBoardData';
import { useViewport } from './viewport';
import './board.css';

export interface BoardProps {
  onOpenMemo?: (memoId: string) => void;
  onOpenCluster?: (topicId: string) => void;
}

const DOCK_H = 150;

function ClusterGlow({ topic, x, y, r }: { topic: Topic; x: number; y: number; r: number }) {
  const a = hashUnit(topic.id, 'a');
  const b = hashUnit(topic.id, 'b');
  const size = r * 2.5;
  return (
    <div
      className="cluster"
      data-topic-id={topic.id}
      style={{ transform: `translate(${x}px, ${y}px)`, ['--c' as string]: topic.color }}
    >
      <div
        className="cluster-glow"
        style={{
          width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2,
          background: `radial-gradient(circle at ${50 + a * 8}% ${50 + b * 8}%, color-mix(in srgb, var(--c) 44%, transparent) 0%, color-mix(in srgb, var(--c) 26%, transparent) 30%, transparent 58%),
            radial-gradient(circle at ${50 - a * 14}% ${50 - b * 14}%, color-mix(in srgb, var(--c) 18%, transparent) 0%, transparent 42%)`,
        }}
      />
      <div className="cluster-label" style={{ top: -r + 6 }} data-cluster-label>
        {topic.name}
      </div>
    </div>
  );
}

export function Board({ onOpenMemo, onOpenCluster }: BoardProps) {
  const { topics, memos, layout, ready } = useBoardData();
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
    // 체크 박스는 자기 클릭 핸들러가 처리하게 둔다
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

  return (
    <div className="board" ref={containerRef} data-testid="board">
      <div className="world" ref={contentRef}>
        {topics.map((t) => {
          const c = layout.clusters[t.id];
          return c ? <ClusterGlow key={t.id} topic={t} x={c.x} y={c.y} r={c.r} /> : null;
        })}
        {memos.map((m) => {
          const p = layout.cards[m.id];
          return p ? (
            <MemoCard key={m.id} memo={m} x={p.x} y={p.y} onToggleDone={(id, d) => void setDone(id, d)} />
          ) : null;
        })}
      </div>
      {memos.length > 0 && (
        <button
          type="button"
          className="overview-btn"
          data-testid="overview-btn"
          data-no-pan
          onClick={toggleOverview}
        >
          {overview ? '돌아오기' : '전체 보기'}
        </button>
      )}
      {ready && memos.length === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
      <span hidden data-testid="board-info" data-clusters={Object.keys(layout.clusters).length} data-cards={memos.length} />
    </div>
  );
}
