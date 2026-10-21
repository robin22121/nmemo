import { describe, expect, it } from 'vitest';
import { detectKind, extractKeywords, LocalAnalyzer, tokenize } from '../../src/core/organize/local';
import { validateResult } from '../../src/core/organize/validate';
import type { AnalyzeRequest } from '../../src/core/organize/types';

const analyzer = new LocalAnalyzer();
const empty = (text: string, input: 'text' | 'photo' = 'text'): AnalyzeRequest => ({
  memo: { id: 'm', input, text }, topics: [], recent: [],
});

describe('LocalAnalyzer', () => {
  it('조사를 떼고 불용어를 뺀 키워드를 뽑는다', () => {
    expect(tokenize('오늘 동네 카페에서 책을 읽었다')).toContain('카페');
    expect(extractKeywords('카페에서 카페 커피 이야기')[0]).toBe('카페');
    expect(tokenize('진짜 너무 그냥')).toEqual([]);
  });

  it('종류를 규칙으로 가른다', () => {
    expect(detectKind('내일 병원 예약 해야 함', 'text')).toBe('todo');
    expect(detectKind('오늘 너무 우울하다', 'text')).toBe('emotion');
    expect(detectKind('버스 정류장에서 고양이를 봤다', 'text')).toBe('observation');
    expect(detectKind('앱 이름을 바꿔보면 어떨까', 'text')).toBe('idea');
    expect(detectKind('', 'photo')).toBe('observation');
  });

  it('비슷한 메모는 같은 주제로 묶인다', async () => {
    const first = validateResult(await analyzer.analyze(empty('동네 카페에서 책 읽기 좋은 자리 찾기')), empty('x'));
    expect('newName' in first.topic).toBe(true);

    const req: AnalyzeRequest = {
      memo: { id: 'm2', input: 'text', text: '새로 생긴 카페 커피 원두가 맛있었다' },
      topics: [{ id: 't1', name: 'newName' in first.topic ? first.topic.newName : '', summary: first.summary }],
      recent: [{ id: 'm1', summary: first.summary, topicId: 't1' }],
    };
    const second = await analyzer.analyze(req);
    expect(second.topic).toEqual({ existingId: 't1' });
    expect(second.related[0]?.id).toBe('m1');
  });

  it('상관없는 메모는 새 주제를 만든다', async () => {
    const req: AnalyzeRequest = {
      memo: { id: 'm2', input: 'text', text: '기타 코드 연습 아침마다 하기' },
      topics: [{ id: 't1', name: '카페 동네', summary: '카페에서 책 읽기' }],
      recent: [{ id: 'm1', summary: '카페에서 책 읽기', topicId: 't1' }],
    };
    const r = await analyzer.analyze(req);
    expect('newName' in r.topic).toBe(true);
    expect(r.related).toEqual([]);
  });

  it('사진 메모는 observation이고 빈 글이면 설명을 채운다', async () => {
    const r = await analyzer.analyze(empty('', 'photo'));
    expect(r.kind).toBe('observation');
    expect(r.text).toBeTruthy();
  });

  it('요약은 40자 이내', async () => {
    const r = await analyzer.analyze(empty('아주 긴 메모입니다 '.repeat(20)));
    expect(Array.from(r.summary).length).toBeLessThanOrEqual(40);
  });
});
