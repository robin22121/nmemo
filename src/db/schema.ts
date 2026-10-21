import Dexie, { type Table } from 'dexie';

export type InputType = 'text' | 'voice' | 'photo';
export type MemoKind = 'idea' | 'emotion' | 'observation' | 'todo';
export type MemoStatus = 'pending' | 'organized' | 'failed';

export const MEMO_KINDS: readonly MemoKind[] = ['idea', 'emotion', 'observation', 'todo'];

export interface Memo {
  id: string;
  createdAt: number;
  input: InputType;
  text: string;
  photo?: Blob;
  kind?: MemoKind;
  emotion?: { label: string; color: string };
  keywords?: string[];
  summary?: string;
  topicId?: string;
  topicLocked: boolean;
  status: MemoStatus;
  attempts: number;
  /** todo 카드 체크 상태 */
  done?: boolean;
  /** 실패 후 다시 시도해도 되는 시각(ms). 지수 백오프용 */
  retryAt?: number;
}

export interface Topic {
  id: string;
  name: string;
  summary: string;
  color: string;
  createdAt: number;
}

export interface Link {
  id: string;
  fromId: string;
  toId: string;
  strength: number;
  reason: string;
}

export class KkeujeogimDB extends Dexie {
  memos!: Table<Memo, string>;
  topics!: Table<Topic, string>;
  links!: Table<Link, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      memos: 'id, createdAt, status, topicId',
      topics: 'id, createdAt',
      links: 'id, fromId, toId',
    });
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

export function linkId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
