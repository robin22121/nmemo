import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef } from 'react';
import { computeLayout, EMPTY_LAYOUT, type Layout } from '../core/layout/clusters';
import { getDb, type Link, type Memo, type Topic } from '../db/schema';

export interface BoardData {
  topics: Topic[];
  memos: Memo[]; // 무리에 붙은(organized + topicId, 또는 고쳐서 다시 정돈 중) 메모
  links: Link[];
  layout: Layout;
  ready: boolean;
}

const EMPTY: never[] = [];

/** Dexie live query → 무리 배치. 배치에 영향 없는 변경(체크 등)에는 다시 계산하지 않는다. */
export function useBoardData(): BoardData {
  const topics = useLiveQuery(() => getDb().topics.toArray(), [], undefined);
  const memos = useLiveQuery(
    // 글을 고쳐 다시 정돈 중인 메모(editReanalyze)도 주제는 그대로라 제자리에 둔다
    async () => (await getDb().memos.toArray()).filter((m) => m.topicId && (m.status === 'organized' || m.editReanalyze)),
    [],
    undefined,
  );
  const links = useLiveQuery(() => getDb().links.toArray(), [], undefined);

  const prev = useRef<Layout>();
  const sig = useMemo(() => {
    if (!topics || !memos || !links) return null;
    const ids = new Set(memos.map((m) => m.id));
    return [
      topics.map((t) => t.id).sort().join(','),
      memos.map((m) => `${m.id}:${m.topicId}`).sort().join(','),
      links.filter((l) => ids.has(l.fromId) && ids.has(l.toId)).map((l) => `${l.id}:${l.strength.toFixed(1)}`).sort().join(','),
    ].join('#');
  }, [topics, memos, links]);

  const layout = useMemo(() => {
    if (sig === null || !topics || !memos || !links) return prev.current ?? EMPTY_LAYOUT;
    const l = computeLayout(
      {
        topics: topics.map((t) => ({ id: t.id })),
        memos: memos.map((m) => ({ id: m.id, topicId: m.topicId! })),
        links: links.map((x) => ({ fromId: x.fromId, toId: x.toId, strength: x.strength })),
      },
      prev.current,
    );
    prev.current = l;
    return l;
    // sig가 바뀔 때만 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return {
    topics: topics ?? EMPTY,
    memos: memos ?? EMPTY,
    links: links ?? EMPTY,
    layout,
    ready: sig !== null,
  };
}
