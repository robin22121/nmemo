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
  /** 처음 정돈된 시각(ms). 재정돈·편집 재정돈은 바꾸지 않는다(Z5, 색인 아님) */
  organizedAt?: number;
  /** 사용자가 직접 주제를 옮긴 마지막 시각(ms). 오분류율 기록(Z5, 색인 아님) */
  lockedAt?: number;
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
  /** 주제 모양 id(shapes.ts SHAPE_IDS). 주제를 만들 때 한 번 정해지고 그대로 유지. 없으면 원(색인 아님) */
  shape?: string;
  /** AI가 메모들의 흐름에서 본 의미 한 줄(40자 이내, 색인 아님) */
  shapeReason?: string;
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
  /** 되돌리기용: 재구성 전 모양·이유(없었으면 undefined) */
  prevShape?: string;
  prevShapeReason?: string;
  undone?: boolean;
}

export function linkId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
