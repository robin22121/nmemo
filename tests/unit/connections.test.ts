import { describe, expect, it } from 'vitest';
import { connectedTopics, visibleMoves } from '../../src/core/connections';
import type { Link, Move } from '../../src/core/types';

const memo = (id: string, topicId: string | undefined, topicLocked = false) => ({ id, topicId, topicLocked });
const link = (fromId: string, toId: string, strength = 0.5, reason = ''): Link => ({ id: `${fromId}|${toId}`, fromId, toId, strength, reason });
const move = (id: string, memoId: string, batchId: string, at: number): Move => ({ id, memoId, batchId, at, fromTopicId: 'a', toTopicId: 'b', reason: '' });

describe('connectedTopics (D25)', () => {
  const memos = [memo('L', 'A', true), memo('a2', 'A'), memo('b1', 'B'), memo('b2', 'B'), memo('c1', 'C'), memo('u', 'B'), memo('p', undefined)];

  it('고정 메모만, 다른 주제만, 주제별로 묶고 강한 순', () => {
    const r = connectedTopics(memos, [
      link('L', 'a2', 0.9), // 같은 주제 → 제외
      link('b1', 'L', 0.4, '커피'), // 방향 무관
      link('L', 'b2', 0.7, '카페'),
      link('L', 'c1', 0.6, '여행'),
      link('L', 'p', 0.8), // 정돈 전 메모 → 제외
    ]);
    const l = r.get('L')!;
    expect(l.map((c) => c.topicId)).toEqual(['B', 'C']);
    expect(l[0]!.links.map((x) => [x.memoId, x.reason])).toEqual([['b2', '카페'], ['b1', '커피']]);
  });

  it('고정이 아닌 메모, 이어진 다른 주제가 없는 고정 메모는 결과에 없다', () => {
    const r = connectedTopics(memos, [link('u', 'c1'), link('L', 'a2')]);
    expect(r.has('u')).toBe(false);
    expect(r.has('L')).toBe(false);
  });

  it('양쪽 다 고정이면 양쪽 모두 받는다', () => {
    const r = connectedTopics([memo('x', 'A', true), memo('y', 'B', true)], [link('x', 'y')]);
    expect(r.get('x')!.map((c) => c.topicId)).toEqual(['B']);
    expect(r.get('y')!.map((c) => c.topicId)).toEqual(['A']);
  });
});

describe('visibleMoves (D26)', () => {
  it('되돌린 묶음은 빼고 최근 것부터, 묶음 기록이 없으면 보인다', () => {
    const r = visibleMoves(
      [move('1', 'm', 'b1', 100), move('2', 'm', 'b2', 300), move('3', 'm', 'b3', 200), move('4', 'm', 'gone', 50)],
      [{ id: 'b1' }, { id: 'b2', undone: true }, { id: 'b3', undone: false }],
    );
    expect(r.map((m) => m.id)).toEqual(['3', '1', '4']);
  });
});
