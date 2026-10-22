import { describe, expect, it } from 'vitest';
import type { AnalyzeRequest, ReorganizeRequest } from '../../src/core/organize/types';
import { normalizeTopicColor } from '../../src/core/palette';
import { InvalidResultError, validateReorganize, validateResult } from '../../src/core/organize/validate';

const req: AnalyzeRequest = {
  memo: { id: 'me', input: 'text', text: 'hi' },
  topics: [{ id: 't1', name: 'A', summary: '' }],
  recent: [{ id: 'r1', summary: 'x' }, { id: 'r2', summary: 'y' }],
};
const good = {
  kind: 'idea', emotion: { label: '설렘', color: '#aabbcc' }, keywords: ['a'], summary: '요약',
  topic: { existingId: 't1' }, related: [],
};

describe('validateResult', () => {
  it('정상 응답은 통과한다', () => {
    expect(validateResult(good, req).topic).toEqual({ existingId: 't1' });
  });

  it('없는 id·범위 밖 strength·자기 자신·중복 관련 항목은 버린다', () => {
    const r = validateResult(
      {
        ...good,
        related: [
          { id: 'r1', strength: 0.8, reason: 'ok' },
          { id: 'ghost', strength: 0.9, reason: 'x' },
          { id: 'r2', strength: 1.7, reason: 'x' },
          { id: 'r2', strength: -1, reason: 'x' },
          { id: 'me', strength: 0.5, reason: 'self' },
          { id: 'r1', strength: 0.3, reason: 'dup' },
          'garbage',
          { id: 'r2', strength: 'high' },
        ],
      },
      req,
    );
    expect(r.related).toEqual([{ id: 'r1', strength: 0.8, reason: 'ok' }]);
  });

  it('관련 메모는 최대 5개, 강한 순', () => {
    const many: AnalyzeRequest = { ...req, recent: Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, summary: 's' })) };
    const r = validateResult({ ...good, related: many.recent.map((m, i) => ({ id: m.id, strength: i / 10, reason: '' })) }, many);
    expect(r.related).toHaveLength(5);
    expect(r.related[0]!.strength).toBeGreaterThan(r.related[4]!.strength);
  });

  it('잘못된 kind·색·키워드는 정리한다', () => {
    const r = validateResult({ ...good, kind: 'weird', emotion: { label: '', color: 'red' }, keywords: ['a', 'a', 3, '', 'b'] }, req);
    expect(r.kind).toBe('idea');
    expect(r.emotion.color).toBe('#c9c2b0');
    expect(r.keywords).toEqual(['a', 'b']);
  });

  it('존재하지 않는 existingId에 newName이 없으면 실패', () => {
    expect(() => validateResult({ ...good, topic: { existingId: 'nope' } }, req)).toThrow(InvalidResultError);
    expect(() => validateResult({ ...good, topic: {} }, req)).toThrow(InvalidResultError);
    expect(() => validateResult({ ...good, topic: undefined }, req)).toThrow(InvalidResultError);
    expect(() => validateResult('x', req)).toThrow(InvalidResultError);
    expect(() => validateResult({ ...good, summary: '  ' }, req)).toThrow(InvalidResultError);
  });

  it('existingId가 틀려도 newName이 있으면 새 주제로 본다', () => {
    const r = validateResult({ ...good, topic: { existingId: 'nope', newName: '새것', newSummary: 's' } }, req);
    expect(r.topic).toEqual({ newName: '새것', newSummary: 's' });
  });
});

describe('validateReorganize', () => {
  const rr: ReorganizeRequest = {
    topic: { id: 't', name: 'T', summary: '', nameLocked: false },
    members: [{ id: 'a', summary: '', keywords: [], locked: false }],
    otherTopics: [{ id: 'o', name: 'O', summary: '', centerKeywords: [] }],
  };
  it('없는 메모·주제와 범위 밖 fit은 버린다', () => {
    const r = validateReorganize(
      {
        topic: { name: '새 이름', summary: 's', centerKeywords: ['k'] },
        moves: [
          { memoId: 'a', to: { existingId: 'o' }, fit: 0.9, reason: 'r' },
          { memoId: 'zzz', to: { existingId: 'o' }, fit: 0.9, reason: 'r' },
          { memoId: 'a', to: { existingId: 'o' }, fit: 0.9, reason: 'dup' },
        ],
      },
      rr,
    );
    expect(r.moves).toHaveLength(1);
    expect(validateReorganize({ topic: { name: 'x' }, moves: [{ memoId: 'a', to: { existingId: 'ghost' }, fit: 1 }, { memoId: 'a', to: { existingId: 'o' }, fit: 2 }] }, rr).moves).toEqual([]);
  });
});

describe('newColor 검증', () => {
  const withColor = (c: unknown) => validateResult({ ...good, topic: { newName: '새', newSummary: '', newColor: c } }, req).topic;
  it('올바른 hex는 통과(팔레트 색은 그대로)', () => {
    expect(withColor('#8EA9E8')).toEqual({ newName: '새', newSummary: '', newColor: '#8ea9e8' });
  });
  it('잘못된 값·없음은 newColor가 빠진다', () => {
    expect(withColor('blue')).toEqual({ newName: '새', newSummary: '' });
    expect(withColor(undefined)).toEqual({ newName: '새', newSummary: '' });
  });
  it('채도·명도가 범위 밖이면 부드럽게 맞춘다', () => {
    const toHsl = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      return { s: mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)), l };
    };
    for (const c of ['#ff0000', '#000000', '#ffffff', '#101010', '#00ff00']) {
      const { s, l } = toHsl(normalizeTopicColor(c)!);
      expect(l).toBeGreaterThanOrEqual(0.54);
      expect(l).toBeLessThanOrEqual(0.74);
      expect(s).toBeLessThanOrEqual(0.74);
      expect(s).toBeGreaterThanOrEqual(0.3);
    }
    expect(normalizeTopicColor('#ff0000')).not.toBe('#ff0000');
    expect(normalizeTopicColor('#12')).toBeUndefined();
  });
});
