import type { Link, Memo, Move, MoveBatch } from './types';

/** 고정 메모에서 관련 링크로 이어진, 다른 주제 하나(D25) */
export interface TopicConnection {
  topicId: string;
  /** 그 주제 안의 이어진 메모들, 강한 순 */
  links: { memoId: string; reason: string; strength: number }[];
}

type MemoLite = Pick<Memo, 'id' | 'topicId' | 'topicLocked'>;
type LinkLite = Pick<Link, 'fromId' | 'toId' | 'strength' | 'reason'>;

/**
 * 사용자가 옮긴(고정) 메모마다, 링크로 이어진 메모가 있는 다른 주제 목록(가장 강한 연결 순).
 * 고정이 아니거나 이어진 다른 주제가 없는 메모는 결과에 없다. 링크를 한 번만 훑는다.
 */
export function connectedTopics(memos: readonly MemoLite[], links: readonly LinkLite[]): Map<string, TopicConnection[]> {
  const byId = new Map(memos.map((m) => [m.id, m]));
  const acc = new Map<string, Map<string, TopicConnection>>();
  const add = (selfId: string, otherId: string, l: LinkLite) => {
    const self = byId.get(selfId);
    const other = byId.get(otherId);
    if (!self?.topicLocked || !self.topicId || !other?.topicId || other.topicId === self.topicId) return;
    let per = acc.get(selfId);
    if (!per) acc.set(selfId, (per = new Map()));
    let c = per.get(other.topicId);
    if (!c) per.set(other.topicId, (c = { topicId: other.topicId, links: [] }));
    c.links.push({ memoId: otherId, reason: l.reason, strength: l.strength });
  };
  for (const l of links) {
    if (l.fromId === l.toId) continue;
    add(l.fromId, l.toId, l);
    add(l.toId, l.fromId, l);
  }
  const out = new Map<string, TopicConnection[]>();
  for (const [id, per] of acc) {
    const list = [...per.values()];
    for (const c of list) c.links.sort((a, b) => b.strength - a.strength);
    list.sort((a, b) => b.links[0]!.strength - a.links[0]!.strength);
    out.set(id, list);
  }
  return out;
}

/** 되돌리지 않은 묶음의 이동만, 최근 것부터(D26). 묶음 기록이 없으면 보인다 */
export function visibleMoves(moves: readonly Move[], batches: readonly Pick<MoveBatch, 'id' | 'undone'>[]): Move[] {
  const undone = new Set(batches.filter((b) => b.undone).map((b) => b.id));
  return moves.filter((m) => !undone.has(m.batchId)).sort((a, b) => b.at - a.at);
}
