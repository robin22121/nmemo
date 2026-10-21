import type { Repo } from '../../src/core/repo';
import type { Link, Memo, Move, MoveBatch, Topic } from '../../src/core/types';

/** core가 저장소 구현에 묶여 있지 않음을 보이는 테스트용 메모리 Repo */
export class MemoryRepo implements Repo {
  memos = new Map<string, Memo>();
  topics = new Map<string, Topic>();
  links = new Map<string, Link>();
  moves = new Map<string, Move>();
  batches = new Map<string, MoveBatch>();

  transaction<T>(fn: (repo: Repo) => Promise<T>): Promise<T> { return fn(this); }

  async getMemo(id: string) { return this.memos.get(id); }
  async addMemo(m: Memo) { this.memos.set(m.id, m); }
  async updateMemo(id: string, patch: Partial<Memo>) {
    const m = this.memos.get(id);
    if (m) this.memos.set(id, { ...m, ...patch });
  }
  async deleteMemo(id: string) { this.memos.delete(id); }
  async listMemosByStatus(...s: Memo['status'][]) { return [...this.memos.values()].filter((m) => s.includes(m.status)); }
  async listMemosByTopic(t: string) { return [...this.memos.values()].filter((m) => m.topicId === t); }
  async countMemosByTopic(t: string) { return (await this.listMemosByTopic(t)).length; }

  async getTopic(id: string) { return this.topics.get(id); }
  async listTopics() { return [...this.topics.values()]; }
  async addTopic(t: Topic) { this.topics.set(t.id, t); }
  async updateTopic(id: string, patch: Partial<Topic>) {
    const t = this.topics.get(id);
    if (t) this.topics.set(id, { ...t, ...patch });
  }
  async deleteTopic(id: string) { this.topics.delete(id); }

  async putLink(l: Link) { this.links.set(l.id, l); }
  async deleteLinksOf(id: string) {
    for (const [k, l] of this.links) if (l.fromId === id || l.toId === id) this.links.delete(k);
  }

  async addMoves(ms: Move[]) { for (const m of ms) this.moves.set(m.id, m); }
  async listMovesByBatch(b: string) { return [...this.moves.values()].filter((m) => m.batchId === b); }
  async listMovesSince(at: number) { return [...this.moves.values()].filter((m) => m.at >= at); }
  async deleteMovesByBatch(b: string) {
    for (const [k, m] of this.moves) if (m.batchId === b) this.moves.delete(k);
  }
  async putBatch(b: MoveBatch) { this.batches.set(b.id, b); }
  async getBatch(id: string) { return this.batches.get(id); }
}

let seq = 0;
export function mkTopic(p: Partial<Topic> & { id: string; name: string }): Topic {
  return {
    summary: '', color: '#e8a87c', createdAt: 1000 + seq++, centerKeywords: [], nameLocked: false,
    lastReorgAt: 0, sinceReorg: 0, ...p,
  };
}
export function mkMemo(p: Partial<Memo> & { id: string }): Memo {
  return {
    createdAt: 1000 + seq++, input: 'text', text: p.summary ?? p.id, topicLocked: false,
    status: 'organized', attempts: 0, ...p,
  };
}
