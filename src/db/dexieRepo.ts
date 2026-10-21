import type { Repo } from '../core/repo';
import type { Link, Memo, Move, MoveBatch, Topic } from '../core/types';
import { getDb, type KkeujeogimDB } from './schema';

/** core/Repo의 IndexedDB(Dexie) 구현 */
export class DexieRepo implements Repo {
  constructor(private readonly db: KkeujeogimDB = getDb()) {}

  transaction<T>(fn: (repo: Repo) => Promise<T>): Promise<T> {
    const d = this.db;
    return d.transaction('rw', [d.memos, d.topics, d.links, d.moves, d.batches], () => fn(this));
  }

  getMemo(id: string): Promise<Memo | undefined> { return this.db.memos.get(id); }
  async addMemo(memo: Memo) { await this.db.memos.add(memo); }
  async updateMemo(id: string, patch: Partial<Memo>) { await this.db.memos.update(id, patch); }
  async deleteMemo(id: string) { await this.db.memos.delete(id); }
  listMemosByStatus(...statuses: Memo['status'][]) { return this.db.memos.where('status').anyOf(statuses).toArray(); }
  listMemosByTopic(topicId: string) { return this.db.memos.where('topicId').equals(topicId).toArray(); }
  countMemosByTopic(topicId: string) { return this.db.memos.where('topicId').equals(topicId).count(); }

  getTopic(id: string): Promise<Topic | undefined> { return this.db.topics.get(id); }
  listTopics() { return this.db.topics.toArray(); }
  async addTopic(topic: Topic) { await this.db.topics.add(topic); }
  async updateTopic(id: string, patch: Partial<Topic>) { await this.db.topics.update(id, patch); }
  async deleteTopic(id: string) { await this.db.topics.delete(id); }

  async putLink(link: Link) { await this.db.links.put(link); }
  async deleteLinksOf(memoId: string) {
    await this.db.links.where('fromId').equals(memoId).delete();
    await this.db.links.where('toId').equals(memoId).delete();
  }

  async addMoves(moves: Move[]) { await this.db.moves.bulkAdd(moves); }
  listMovesByBatch(batchId: string) { return this.db.moves.where('batchId').equals(batchId).toArray(); }
  listMovesSince(at: number) { return this.db.moves.where('at').aboveOrEqual(at).toArray(); }
  async deleteMovesByBatch(batchId: string) { await this.db.moves.where('batchId').equals(batchId).delete(); }
  async putBatch(batch: MoveBatch) { await this.db.batches.put(batch); }
  getBatch(id: string): Promise<MoveBatch | undefined> { return this.db.batches.get(id); }
}

export function dexieRepo(): DexieRepo {
  return new DexieRepo(getDb());
}
