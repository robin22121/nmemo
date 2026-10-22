import type { InputType, MemoKind } from '../types';

export interface AnalyzeRequest {
  memo: { id: string; input: InputType; text: string; photoBase64?: string; photoMime?: string };
  /** 기존 주제 전부(최대 60) */
  topics: { id: string; name: string; summary: string; color?: string }[];
  /** 최근 정돈된 메모 요약(최대 80) */
  recent: { id: string; summary: string; topicId?: string }[];
}

export interface AnalyzeResult {
  kind: MemoKind;
  emotion: { label: string; color: string };
  /** 1~5개 */
  keywords: string[];
  /** 40자 이내 */
  summary: string;
  /** 사진 메모일 때 장면·글자·분위기 설명 */
  text?: string;
  topic: { existingId: string } | { newName: string; newSummary: string; newColor?: string; newShape?: string };
  /** 최대 5개, strength 0~1 */
  related: { id: string; strength: number; reason: string }[];
}

export interface ReorganizeRequest {
  topic: { id: string; name: string; summary: string; nameLocked: boolean; shape?: string };
  /** 그 주제의 메모 전부(최대 80) */
  members: { id: string; summary: string; keywords: string[]; locked: boolean }[];
  otherTopics: { id: string; name: string; summary: string; centerKeywords: string[] }[];
}

export interface ReorganizeResult {
  /** nameLocked면 name은 무시된다 */
  topic: { name: string; summary: string; centerKeywords: string[]; shape?: string; shapeReason?: string };
  moves: {
    memoId: string;
    to: { existingId: string } | { newName: string; newSummary: string };
    fit: number;
    reason: string;
  }[];
}

export interface Analyzer {
  /** true면 요청에 사진(base64)을 싣는다 */
  readonly usesPhoto?: boolean;
  analyze(req: AnalyzeRequest): Promise<AnalyzeResult>;
  reorganize(req: ReorganizeRequest): Promise<ReorganizeResult>;
}

export const MAX_TOPICS = 60;
export const MAX_RECENT = 80;
export const MAX_RELATED = 5;
export const MAX_SUMMARY = 40;
export const MAX_SHAPE_REASON = 40;
export const MAX_MEMBERS = 80;

export type { MemoKind };
