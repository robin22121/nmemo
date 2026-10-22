import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '../../src/core/layout/clusters';
import { fitClusterCards, GLOBE, globeViewport, placeTopics, projectGlobe, snapTarget, wrapDeg } from '../../src/core/layout/globe';

function gen(nTopics: number, nMemos: number): LayoutInput {
  const topics = Array.from({ length: nTopics }, (_, i) => ({ id: `t${i}` }));
  const memos = Array.from({ length: nMemos }, (_, i) => ({ id: `m${i}`, topicId: `t${i % nTopics}` }));
  const links = Array.from({ length: nMemos }, (_, i) => ({ fromId: `m${i}`, toId: `m${(i * 5 + 3) % nMemos}`, strength: 0.5 }))
    .filter((l) => l.fromId !== l.toId);
  return { topics, memos, links };
}

const VP = globeViewport(375, 812);

/** 정렬된 값들을 gap 이상 벌어지는 곳에서 나눈 묶음 수 */
function groups(values: number[], gap: number): number {
  const s = [...values].sort((a, b) => a - b);
  let g = s.length ? 1 : 0;
  for (let i = 1; i < s.length; i++) if (s[i]! - s[i - 1]! >= gap) g++;
  return g;
}

describe('placeTopics', () => {
  it('같은 입력이면 같은 결과', () => {
    expect(placeTopics(gen(6, 40))).toEqual(placeTopics(gen(6, 40)));
  });

  it('간격은 30°~72°, 같은 줄의 경도는 겹치지 않는다', () => {
    for (const n of [1, 2, 3, 5, 6, 9, 12]) {
      const p = placeTopics(gen(n, n * 4));
      expect(p.spacing).toBeGreaterThanOrEqual(GLOBE.minSpacing);
      expect(p.spacing).toBeLessThanOrEqual(GLOBE.maxSpacing);
      const ls = Object.values(p.topics).map((t) => t.lambda);
      for (let i = 0; i < ls.length; i++)
        for (let j = i + 1; j < ls.length; j++) expect(Math.abs(wrapDeg(ls[i]! - ls[j]!))).toBeGreaterThanOrEqual(p.spacing - 0.01);
    }
  });

  it('6주제: β는 ±30° 안, 10° 이상 벌어진 3군 이상, φ=0에서 y 24px 이상 벌어진 3단 이상', () => {
    const p = placeTopics(gen(6, 40));
    const betas = Object.values(p.topics).map((t) => t.beta);
    for (const b of betas) expect(Math.abs(b)).toBeLessThanOrEqual(30);
    expect(groups(betas, 10)).toBeGreaterThanOrEqual(3);
    // 뒷면은 화면에 거의 안 보이므로 앞쪽 반구(|Δ|≤90°)의 주제로 본다
    const ys = Object.values(p.topics)
      .map((t) => projectGlobe(t.lambda, t.beta, 0, VP))
      .filter((q) => q.side !== 'back')
      .map((q) => q.y);
    expect(groups(ys, 24)).toBeGreaterThanOrEqual(3);
  });

  it('원 위 이웃끼리 높이가 다르다', () => {
    for (const n of [3, 4, 6, 7]) {
      const p = placeTopics(gen(n, n * 3));
      const b = p.order.map((id) => p.topics[id]!.beta);
      for (let i = 0; i < n; i++) expect(Math.abs(b[i]! - b[(i + 1) % n]!)).toBeGreaterThanOrEqual(10);
    }
  });

  it('주제 1개는 정면, 2개는 정면과 +간격(뒷면 아님)', () => {
    const one = placeTopics(gen(1, 5));
    expect(Object.values(one.topics)).toEqual([{ lambda: 0, beta: 0 }]);
    const two = placeTopics(gen(2, 6));
    const ls = Object.values(two.topics).map((t) => t.lambda).sort((a, b) => a - b);
    expect(ls).toEqual([0, GLOBE.maxSpacing]);
  });

  it('15주제: 위도 두 줄, 간격 범위 유지, 모든 주제가 배치된다', () => {
    const p = placeTopics(gen(15, 200));
    expect(p.rows).toBe(2);
    expect(p.order).toHaveLength(15);
    expect(p.spacing).toBeGreaterThanOrEqual(GLOBE.minSpacing);
    expect(p.spacing).toBeLessThanOrEqual(GLOBE.maxSpacing);
    // 줄마다 경도가 엇갈려 같은 경도에 두 무리가 겹치지 않고, 같은 줄 안 간격은 spacing 이상
    const ls = Object.values(p.topics).map((t) => t.lambda);
    expect(new Set(ls).size).toBe(15);
    for (let r = 0; r < p.rows; r++) {
      const row = p.order.filter((_, i) => i % p.rows === r).map((id) => p.topics[id]!.lambda);
      for (let i = 0; i < row.length; i++)
        for (let j = i + 1; j < row.length; j++) expect(Math.abs(wrapDeg(row[i]! - row[j]!))).toBeGreaterThanOrEqual(p.spacing - 0.01);
    }
  });

  it('링크가 강한 주제끼리 이웃한다', () => {
    const input: LayoutInput = {
      topics: ['a', 'b', 'c', 'd'].map((id) => ({ id })),
      memos: ['a', 'b', 'c', 'd'].map((t) => ({ id: `m${t}`, topicId: t })),
      links: [{ fromId: 'ma', toId: 'mc', strength: 1 }],
    };
    const o = placeTopics(input).order;
    expect(Math.abs(o.indexOf('a') - o.indexOf('c'))).toBe(1);
  });
});

describe('projectGlobe', () => {
  it('정면 크기 1·투명도 1, 60°에서 약 0.45, 뒷면 0.3', () => {
    const f = projectGlobe(0, 0, 0, VP);
    expect(f.scale).toBeCloseTo(1, 5);
    expect(f.opacity).toBeCloseTo(1, 5);
    expect(f.side).toBe('front');
    expect(projectGlobe(60, 0, 0, VP).scale).toBeCloseTo(0.45, 2);
    expect(projectGlobe(180, 0, 0, VP).scale).toBeCloseTo(0.3, 5);
  });

  it('|Δ|>90°: dx/dφ 부호가 앞면과 반대, 투명도 ≤ 0.2', () => {
    const dxdphi = (lambda: number) => projectGlobe(lambda, 10, 0.5, VP).x - projectGlobe(lambda, 10, -0.5, VP).x;
    for (const front of [0, 30, -45, 80]) expect(dxdphi(front)).toBeLessThan(0);
    for (const back of [95, 120, 180, -130, -100]) {
      expect(dxdphi(back)).toBeGreaterThan(0);
      expect(projectGlobe(back, 10, 0, VP).opacity).toBeLessThanOrEqual(0.2);
      expect(projectGlobe(back, 10, 0, VP).side).toBe('back');
    }
  });

  it('정면에서 멀어질수록 작고 흐리다', () => {
    let prev = projectGlobe(0, 0, 0, VP);
    for (let d = 10; d <= 180; d += 10) {
      const q = projectGlobe(d, 0, 0, VP);
      expect(q.scale).toBeLessThan(prev.scale);
      expect(q.opacity).toBeLessThan(prev.opacity);
      prev = q;
    }
  });
});

describe('snapTarget / fitClusterCards', () => {
  it('가장 가까운 주제로, 감기 없이', () => {
    expect(snapTarget(350, [0, 60, 120])).toBe(360);
    expect(snapTarget(-25, [0, 60, -60])).toBe(0);
    expect(snapTarget(-35, [0, 60, -60])).toBe(-60);
  });

  it('가로 폭 안으로 맞추고 카드가 겹치지 않는다', () => {
    const cards = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, x: Math.cos(i) * 260, y: Math.sin(i * 1.7) * 200 }));
    const out = fitClusterCards(cards, 120);
    expect(out).toHaveLength(30);
    for (const c of out) expect(Math.abs(c.x)).toBeLessThanOrEqual(120.1);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        expect(Math.abs(a.x - b.x) >= GLOBE.cardW - 0.2 || Math.abs(a.y - b.y) >= GLOBE.cardH - 0.2).toBe(true);
      }
  });
});
