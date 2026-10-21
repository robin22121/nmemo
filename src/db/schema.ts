import Dexie, { type Table } from 'dexie';
import type { Link, Memo, Move, MoveBatch, Topic } from '../core/types';

export * from '../core/types';

export class KkeujeogimDB extends Dexie {
  memos!: Table<Memo, string>;
  topics!: Table<Topic, string>;
  links!: Table<Link, string>;
  moves!: Table<Move, string>;
  batches!: Table<MoveBatch, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      memos: 'id, createdAt, status, topicId',
      topics: 'id, createdAt',
      links: 'id, fromId, toId',
    });
    // v2: 주제 재구성 (Topic 필드 추가, moves·batches 테이블)
    this.version(2)
      .stores({
        memos: 'id, createdAt, status, topicId',
        topics: 'id, createdAt',
        links: 'id, fromId, toId',
        moves: 'id, batchId, memoId, at',
        batches: 'id, topicId, at',
      })
      .upgrade((tx) =>
        tx
          .table('topics')
          .toCollection()
          .modify((t: Partial<Topic> & { createdAt: number }) => {
            t.centerKeywords ??= [];
            t.nameLocked ??= false;
            t.lastReorgAt ??= t.createdAt;
            t.sinceReorg ??= 0;
          }),
      );
  }
}

let current: KkeujeogimDB | null = null;

/** DB를 연다. `?demo=1`이면 호출하는 쪽에서 다른 이름을 넘긴다. */
export function initDb(name = 'kkeujeogim'): KkeujeogimDB {
  if (current) current.close();
  current = new KkeujeogimDB(name);
  return current;
}

export function getDb(): KkeujeogimDB {
  return current ?? initDb();
}
