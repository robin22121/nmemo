import type { Link, Memo, Move, MoveBatch, Topic } from './types';

/**
 * 저장소 인터페이스. core는 이것만 안다.
 * 구현: src/db/dexieRepo.ts (IndexedDB), tests/unit/memoryRepo.ts (테스트용 메모리).
 */
export interface Repo {
  /** fn 안의 모든 읽기·쓰기를 하나의 원자적 단위로 묶는다 */
  transaction<T>(fn: (repo: Repo) => Promise<T>): Promise<T>;

  getMemo(id: string): Promise<Memo | undefined>;
  addMemo(memo: Memo): Promise<void>;
  updateMemo(id: string, patch: Partial<Memo>): Promise<void>;
  deleteMemo(id: string): Promise<void>;
  listMemosByStatus(...statuses: Memo['status'][]): Promise<Memo[]>;
  listMemosByTopic(topicId: string): Promise<Memo[]>;
  countMemosByTopic(topicId: string): Promise<number>;

  getTopic(id: string): Promise<Topic | undefined>;
  listTopics(): Promise<Topic[]>;
  addTopic(topic: Topic): Promise<void>;
  updateTopic(id: string, patch: Partial<Topic>): Promise<void>;
  deleteTopic(id: string): Promise<void>;

  putLink(link: Link): Promise<void>;
  deleteLinksOf(memoId: string): Promise<void>;

  addMoves(moves: Move[]): Promise<void>;
  listMovesByBatch(batchId: string): Promise<Move[]>;
  listMovesSince(at: number): Promise<Move[]>;
  deleteMovesByBatch(batchId: string): Promise<void>;
  putBatch(batch: MoveBatch): Promise<void>;
  getBatch(id: string): Promise<MoveBatch | undefined>;
}
