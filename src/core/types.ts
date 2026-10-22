/** 도메인 타입. React·DOM·저장소 구현에 의존하지 않는다. */

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
  /** 사용자가 메모장에서 직접 고른 종류·감정 → 재정돈이 덮어쓰지 않는다(색인 아님) */
  kindLocked?: boolean;
  emotionLocked?: boolean;
  /** 글을 고쳐 다시 정돈하는 중: 주제는 그대로 두고 요약·키워드·링크만 갱신한다(색인 아님) */
  editReanalyze?: boolean;
}

export interface Topic {
  id: string;
  name: string;
  summary: string;
  color: string;
  createdAt: number;
  /** 무리의 중심 키워드 */
  centerKeywords: string[];
  /** 사용자가 이름을 직접 정함 → AI가 이름을 바꾸지 않고, 이 이름을 중심으로 삼는다 */
  nameLocked: boolean;
  lastReorgAt: number;
  /** 마지막 재구성 뒤 들어온 메모 수 */
  sinceReorg: number;
}

export interface Link {
  id: string;
  fromId: string;
  toId: string;
  strength: number;
  reason: string;
}

/** 재구성으로 메모가 주제 사이를 옮겨간 기록 */
export interface Move {
  id: string;
  batchId: string;
  memoId: string;
  fromTopicId: string;
  toTopicId: string;
  reason: string;
  at: number;
}

/** 재구성 한 번의 묶음. 되돌리기에 쓸 이전 이름·요약을 함께 저장한다. */
export interface MoveBatch {
  id: string;
  topicId: string;
  at: number;
  prevName: string;
  prevSummary: string;
  prevCenterKeywords: string[];
  newName: string;
  moveCount: number;
  undone?: boolean;
}

export function linkId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
