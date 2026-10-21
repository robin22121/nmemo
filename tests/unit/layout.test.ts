import { describe, expect, it } from 'vitest';
import { CARD_R, CARD_RY, computeLayout, type LayoutInput } from '../../src/core/layout/clusters';

function gen(nTopics: number, nMemos: number): LayoutInput {
  const topics = Array.from({ length: nTopics }, (_, i) => ({ id: `t${i}` }));
  const memos = Array.from({ length: nMemos }, (_, i) => ({ id: `m${i}`, topicId: `t${(i * 7 + (i % 3)) % nTopics}` }));
  const links = Array.from({ length: nMemos }, (_, i) => ({ fromId: `m${i}`, toId: `m${(i * 5 + 3) % nMemos}`, strength: 0.5 }))
    .filter((l) => l.fromId !== l.toId);
  return { topics, memos, links };
}

describe('computeLayout', () => {
  it('같은 입력이면 같은 배치', () => {
    const a = computeLayout(gen(6, 40));
    const b = computeLayout(gen(6, 40));
    expect(b).toEqual(a);
  });

  it('무리끼리 겹치지 않는다', () => {
    for (const [t, m] of [[6, 40], [8, 120], [3, 9], [12, 60]] as const) {
      const l = computeLayout(gen(t, m));
      const cs = Object.values(l.clusters);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          const d = Math.hypot(cs[i]!.x - cs[j]!.x, cs[i]!.y - cs[j]!.y);
          expect(d).toBeGreaterThanOrEqual(cs[i]!.r + cs[j]!.r);
        }
    }
  });

  it('카드는 자기 무리 원 안에 있고 모든 카드가 배치된다', () => {
    const input = gen(6, 40);
    const l = computeLayout(input);
    expect(Object.keys(l.cards)).toHaveLength(40);
    for (const m of input.memos) {
      const c = l.cards[m.id]!;
      const cl = l.clusters[m.topicId]!;
      expect(Math.hypot(c.x - cl.x, c.y - cl.y) + CARD_R).toBeLessThanOrEqual(cl.r + 1);
    }
  });

  it('카드끼리 거의 겹치지 않는다(같은 무리 안)', () => {
    const l = computeLayout(gen(6, 40));
    const cards = Object.values(l.cards);
    let worst = Infinity;
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++)
        if (cards[i]!.topicId === cards[j]!.topicId)
          worst = Math.min(worst, Math.hypot(cards[i]!.x - cards[j]!.x, cards[i]!.y - cards[j]!.y));
    expect(worst).toBeGreaterThan(CARD_RY * 1.6);
  });

  it('격자처럼 정렬되지 않는다: 무리 중심 x/y 값이 제각각', () => {
    const cs = Object.values(computeLayout(gen(6, 40)).clusters);
    const xs = new Set(cs.map((c) => Math.round(c.x / 20)));
    const ys = new Set(cs.map((c) => Math.round(c.y / 20)));
    expect(xs.size).toBeGreaterThanOrEqual(5);
    expect(ys.size).toBeGreaterThanOrEqual(5);
  });

  it('새 메모가 들어와도 기존 카드는 조금만 움직인다', () => {
    const input = gen(6, 40);
    const before = computeLayout(input);
    const next: LayoutInput = { ...input, memos: [...input.memos, { id: 'new', topicId: 't1' }] };
    const after = computeLayout(next, before);
    let total = 0;
    for (const m of input.memos) total += Math.hypot(after.cards[m.id]!.x - before.cards[m.id]!.x, after.cards[m.id]!.y - before.cards[m.id]!.y);
    expect(total / input.memos.length).toBeLessThan(60);
  });

  it('새 주제가 생겨도 기존 무리가 크게 튀지 않고 겹치지 않는다', () => {
    const input = gen(6, 40);
    const before = computeLayout(input);
    const next: LayoutInput = { topics: [...input.topics, { id: 'tn' }], memos: [...input.memos, { id: 'n1', topicId: 'tn' }, { id: 'n2', topicId: 'tn' }], links: input.links };
    const after = computeLayout(next, before);
    expect(after.clusters.tn).toBeTruthy();
    const cs = Object.values(after.clusters);
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        expect(Math.hypot(cs[i]!.x - cs[j]!.x, cs[i]!.y - cs[j]!.y)).toBeGreaterThanOrEqual(cs[i]!.r + cs[j]!.r);
  });

  it('카드 200개도 50ms 안팎(여유 있게 300ms 이내)', () => {
    const input = gen(8, 200);
    computeLayout(input); // 워밍업
    const t0 = performance.now();
    computeLayout(input);
    const ms = performance.now() - t0;
    console.log(`layout 200 cards: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(300);
  });

  it('빈 입력', () => {
    expect(computeLayout({ topics: [], memos: [], links: [] }).cards).toEqual({});
  });
});
