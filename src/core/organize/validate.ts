import { normalizeTopicColor } from '../palette.ts';
import { isShapeId } from '../shapes.ts';
import { MEMO_KINDS, type MemoKind } from '../types.ts';
import {
  MAX_RELATED,
  MAX_SHAPE_REASON,
  MAX_SUMMARY,
  type AnalyzeRequest,
  type AnalyzeResult,
  type ReorganizeRequest,
  type ReorganizeResult,
} from './types.ts';

export class InvalidResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResultError';
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const NEUTRAL_COLOR = '#c9c2b0';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 경계(공백·문장부호)에서 끊을 수 있는 글자 */
const BREAK = /[\s,.!?·…~、，。;:]/;

/**
 * max자(코드 포인트)를 넘으면 낱말 중간이 아니라 max자 안의 마지막 공백·문장부호 앞에서 자른다.
 * 앞쪽 절반 안에 경계가 없으면 max자에서 그냥 자른다.
 */
export function trimPhrase(s: string, max: number): string {
  const cs = Array.from(s);
  if (cs.length <= max) return s;
  // max번째 글자 바로 뒤가 경계면 max자 그대로가 완결
  let cut = BREAK.test(cs[max]!) ? max : -1;
  for (let i = max - 1; cut < 0 && i >= Math.ceil(max / 2); i--) if (BREAK.test(cs[i]!)) cut = i;
  if (cut < 0) return cs.slice(0, max).join('');
  return cs.slice(0, cut).join('').replace(/[\s,·、，;:]+$/u, '');
}

/**
 * 분석기가 돌려준 값(AI 응답 포함)을 검증·정리한다.
 * - 잘못된 항목(없는 id, 범위 밖 strength 등)은 버린다.
 * - topic이 엉망이면 InvalidResultError (→ 정돈 실패로 처리).
 */
export function validateResult(raw: unknown, req: AnalyzeRequest): AnalyzeResult {
  if (!isRecord(raw)) throw new InvalidResultError('결과가 객체가 아니에요');

  const kind: MemoKind = MEMO_KINDS.includes(raw.kind as MemoKind) ? (raw.kind as MemoKind) : 'idea';

  const e = isRecord(raw.emotion) ? raw.emotion : {};
  const emotion = {
    label: str(e.label).slice(0, 8) || '담담',
    color: typeof e.color === 'string' && HEX.test(e.color) ? e.color.toLowerCase() : NEUTRAL_COLOR,
  };

  const keywords = Array.isArray(raw.keywords)
    ? [...new Set(raw.keywords.map(str).filter((k) => k.length > 0 && k.length <= 20))].slice(0, 5)
    : [];

  const summary = Array.from(str(raw.summary)).slice(0, MAX_SUMMARY).join('');
  if (!summary) throw new InvalidResultError('summary가 비어 있어요');

  const text = str(raw.text) || undefined;

  if (!isRecord(raw.topic)) throw new InvalidResultError('topic이 없어요');
  let topic: AnalyzeResult['topic'];
  const existingId = str(raw.topic.existingId);
  const newName = str(raw.topic.newName);
  if (existingId && req.topics.some((t) => t.id === existingId)) {
    topic = { existingId };
  } else if (newName) {
    const newColor = normalizeTopicColor(raw.topic.newColor);
    const newShape = str(raw.topic.newShape);
    topic = {
      newName: newName.slice(0, 24),
      newSummary: str(raw.topic.newSummary).slice(0, 60),
      ...(newColor ? { newColor } : {}),
      ...(isShapeId(newShape) ? { newShape } : {}),
    };
  } else {
    throw new InvalidResultError('topic을 알 수 없어요');
  }

  const valid = new Set(req.recent.map((r) => r.id));
  const seen = new Set<string>();
  const related: AnalyzeResult['related'] = [];
  if (Array.isArray(raw.related)) {
    for (const item of raw.related) {
      if (!isRecord(item)) continue;
      const id = str(item.id);
      const strength = item.strength;
      if (!id || id === req.memo.id || !valid.has(id) || seen.has(id)) continue;
      if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) continue;
      seen.add(id);
      related.push({ id, strength, reason: str(item.reason).slice(0, 80) });
    }
  }
  related.sort((a, b) => b.strength - a.strength);

  return { kind, emotion, keywords, summary, text, topic, related: related.slice(0, MAX_RELATED) };
}

/**
 * 재구성 결과 검증. 없는 메모·주제 id, 범위 밖 fit은 버린다.
 * (jitter 방지 규칙 — fit 하한, 40% 상한, locked 제외 — 은 적용 단계에서 다시 강제한다.)
 */
export function validateReorganize(raw: unknown, req: ReorganizeRequest): ReorganizeResult {
  if (!isRecord(raw)) throw new InvalidResultError('결과가 객체가 아니에요');
  if (!isRecord(raw.topic)) throw new InvalidResultError('topic이 없어요');
  const name = str(raw.topic.name).slice(0, 24) || req.topic.name;
  const summary = str(raw.topic.summary).slice(0, 60) || req.topic.summary;
  const centerKeywords = Array.isArray(raw.topic.centerKeywords)
    ? [...new Set(raw.topic.centerKeywords.map(str).filter((k) => k.length > 0 && k.length <= 20))].slice(0, 6)
    : [];

  const memberIds = new Set(req.members.map((m) => m.id));
  const topicIds = new Set(req.otherTopics.map((t) => t.id));
  const seen = new Set<string>();
  const moves: ReorganizeResult['moves'] = [];
  if (Array.isArray(raw.moves)) {
    for (const item of raw.moves) {
      if (!isRecord(item)) continue;
      const memoId = str(item.memoId);
      const fit = item.fit;
      if (!memberIds.has(memoId) || seen.has(memoId)) continue;
      if (typeof fit !== 'number' || !Number.isFinite(fit) || fit < 0 || fit > 1) continue;
      if (!isRecord(item.to)) continue;
      const existingId = str(item.to.existingId);
      const newName = str(item.to.newName);
      let to: ReorganizeResult['moves'][number]['to'];
      if (existingId && topicIds.has(existingId)) to = { existingId };
      else if (newName) to = { newName: newName.slice(0, 24), newSummary: str(item.to.newSummary).slice(0, 60) };
      else continue;
      seen.add(memoId);
      moves.push({ memoId, to, fit, reason: str(item.reason).slice(0, 80) });
    }
  }
  const shape = str(raw.topic.shape);
  const shapeReason = trimPhrase(str(raw.topic.shapeReason), MAX_SHAPE_REASON);
  return {
    topic: { name, summary, centerKeywords, ...(isShapeId(shape) ? { shape } : {}), ...(shapeReason ? { shapeReason } : {}) },
    moves,
  };
}
