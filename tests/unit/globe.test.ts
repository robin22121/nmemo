import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '../../src/core/layout/clusters';
import { angularDist, bracket, expansion, focusExpansion, topicOpacity, fisheye, GLOBE, globeViewport, pitchAt, pickShown, placeTopics, projectGlobe, ringCapacity, ringLayout, snapYaw } from '../../src/core/layout/globe';

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

function minSeparation(p: ReturnType<typeof placeTopics>): number {
  const ts = Object.values(p.topics);
  let m = Infinity;
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) m = Math.min(m, angularDist(ts[i]!.lambda, ts[i]!.beta, ts[j]!.lambda, ts[j]!.beta));
  return m;
}

describe('placeTopics (천구)', () => {
  it('같은 입력이면 같은 결과', () => {
    expect(placeTopics(gen(6, 40))).toEqual(placeTopics(gen(6, 40)));
  });

  it('위도는 ±betaMax 안, 이웃끼리 떨어져 있다', () => {
    for (const [n, sep] of [[3, 40], [6, 35], [9, 28], [15, 20]] as const) {
      const p = placeTopics(gen(n, n * 4));
      expect(Object.keys(p.topics)).toHaveLength(n);
      for (const t of Object.values(p.topics)) expect(Math.abs(t.beta)).toBeLessThanOrEqual(GLOBE.betaMax + 0.1);
      expect(minSeparation(p)).toBeGreaterThanOrEqual(sep);
    }
  });

  it('6주제: β가 10° 이상 벌어진 3군 이상, φ=0(시선 높이는 자동)에서 정면 외 이름표 y가 화면 높이 60% 이상에 퍼진다', () => {
    const p = placeTopics(gen(6, 40));
    const ts = Object.values(p.topics);
    expect(groups(ts.map((t) => t.beta), 10)).toBeGreaterThanOrEqual(3);
    const qs = ts.map((t) => projectGlobe(t.lambda, t.beta, 0, pitchAt(0, ts), VP));
    const front = qs.reduce((b, q) => (q.dist < b.dist ? q : b));
    const ys = qs.filter((q) => q !== front).map((q) => q.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(812 * 0.6);
  });

  it('주제 1개는 정면, 2개는 정면과 옆(뒷면 아님)', () => {
    expect(Object.values(placeTopics(gen(1, 5)).topics)).toEqual([{ lambda: 0, beta: 0 }]);
    for (const t of Object.values(placeTopics(gen(2, 6)).topics)) expect(projectGlobe(t.lambda, t.beta, 0, 0, VP).z).toBeGreaterThan(0);
  });

  it('링크가 강한 주제끼리 가까이 놓인다', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const input: LayoutInput = {
      topics: ids.map((id) => ({ id })),
      memos: ids.map((t) => ({ id: `m${t}`, topicId: t })),
      links: [{ fromId: 'ma', toId: 'me', strength: 1 }],
    };
    const p = placeTopics(input);
    const d = (x: string, y: string) => angularDist(p.topics[x]!.lambda, p.topics[x]!.beta, p.topics[y]!.lambda, p.topics[y]!.beta);
    const others = ids.filter((x) => x !== 'a' && x !== 'e').map((x) => d('a', x));
    expect(d('a', 'e')).toBeLessThanOrEqual(Math.min(...others) + 0.01);
  });
});

describe('projectGlobe', () => {
  it('보는 방향의 주제는 화면 정가운데, 크기 1·투명도 1', () => {
    for (const [l, b] of [[0, 0], [40, 30], [-120, -55]] as const) {
      const q = projectGlobe(l, b, l, b, VP);
      expect(q.x).toBeCloseTo(VP.cx, 6);
      expect(q.y).toBeCloseTo(VP.cy, 6);
      expect(q.scale).toBeCloseTo(1, 5);
      expect(q.opacity).toBeCloseTo(1, 5);
      expect(q.side).toBe('front');
    }
    expect(projectGlobe(60, 0, 0, 0, VP).scale).toBeCloseTo(0.45, 2);
    expect(projectGlobe(180, 0, 0, 0, VP).scale).toBeCloseTo(0.3, 5);
  });

  it('|Δ|>90°: dx/dφ 부호가 앞면과 반대. 옆 투명도 ≥ 0.75, 뒷면은 0.35~0.45로 흐리지만 보인다', () => {
    const dxdphi = (lambda: number) => projectGlobe(lambda, 10, 0.5, 0, VP).x - projectGlobe(lambda, 10, -0.5, 0, VP).x;
    for (const front of [0, 30, -45, 80]) expect(dxdphi(front)).toBeLessThan(0);
    for (const back of [95, 120, 180, -130, -100]) {
      expect(dxdphi(back)).toBeGreaterThan(0);
      expect(projectGlobe(back, 10, 0, 0, VP).side).toBe('back');
    }
    for (const side of [30, -60, 85]) expect(projectGlobe(side, 10, 0, 0, VP).opacity).toBeGreaterThanOrEqual(0.75);
    for (const back of [120, 180, -130]) {
      expect(projectGlobe(back, 10, 0, 0, VP).opacity).toBeGreaterThanOrEqual(0.35);
      expect(projectGlobe(back, 10, 0, 0, VP).opacity).toBeLessThanOrEqual(0.45);
    }
  });

  it('위로 돌리면(θ↑) 위쪽 주제가 내려온다', () => {
    expect(projectGlobe(0, 40, 0, 20, VP).y).toBeGreaterThan(projectGlobe(0, 40, 0, 0, VP).y);
  });
});

describe('expansion / snapTarget', () => {
  it('정면 근처 1, 멀면 0, 사이는 단조 감소', () => {
    expect(expansion(0)).toBe(1);
    expect(expansion(GLOBE.expandFull)).toBe(1);
    expect(expansion(GLOBE.expandNone)).toBe(0);
    expect(expansion(90)).toBe(0);
    let prev = 1;
    for (let d = GLOBE.expandFull; d <= GLOBE.expandNone; d += 1) {
      const e = expansion(d);
      expect(e).toBeLessThanOrEqual(prev);
      prev = e;
    }
    expect(expansion(20)).toBeGreaterThan(0);
    expect(expansion(20)).toBeLessThan(1);
  });

  it('경도가 가장 가까운 주제로, φ는 감기 없이', () => {
    expect(snapYaw(350, [0, 60, 120])).toBe(360);
    expect(snapYaw(-25, [0, 60, -60])).toBe(0);
    expect(snapYaw(-35, [0, 60, -60])).toBe(-60);
  });
});

describe('pitchAt (시선 높이는 φ를 따라간다)', () => {
  const pts = [{ lambda: 0, beta: 40 }, { lambda: 90, beta: -50 }, { lambda: 200, beta: 10 }];
  it('주제 경도에서는 정확히 그 주제 위도 → 멈추면 이름표가 정가운데', () => {
    for (const p of pts) {
      expect(pitchAt(p.lambda, pts)).toBeCloseTo(p.beta, 9);
      expect(pitchAt(p.lambda + 360, pts)).toBeCloseTo(p.beta, 9);
      const q = projectGlobe(p.lambda, p.beta, p.lambda, pitchAt(p.lambda, pts), VP);
      expect(Math.abs(q.x - VP.cx)).toBeLessThan(0.01);
      expect(Math.abs(q.y - VP.cy)).toBeLessThan(0.01);
    }
  });
  it('사이에서는 끊김 없이 이웃 두 위도 사이 값', () => {
    let prev = pitchAt(0, pts);
    for (let f = 1; f <= 360; f++) {
      const v = pitchAt(f, pts);
      expect(Math.abs(v - prev)).toBeLessThan(3);
      prev = v;
    }
    // 경도 0°(β 40)와 90°(β -50) 한가운데 → 두 위도 사이(smoothstep 0.5 = 정확히 평균)
    const mid = pitchAt(45, pts);
    expect(mid).toBeLessThan(40);
    expect(mid).toBeGreaterThan(-50);
    expect(mid).toBeCloseTo(-5, 9);
  });
});

describe('fisheye', () => {
  const v = { cx: 187.5, cy: 406, width: 375, height: 812 };
  it('같은 카드가 화면 중심에서 가장 크고 가장자리로 갈수록 작다', () => {
    expect(fisheye(v.cx, v.cy, v)).toBe(1);
    const mid = fisheye(v.cx + 90, v.cy, v), edge = fisheye(v.cx + 180, v.cy, v), far = fisheye(0, 0, v);
    expect(mid).toBeLessThan(1);
    expect(edge).toBeLessThan(mid);
    expect(far).toBeCloseTo(GLOBE.fisheyeEdge, 5);
    expect(fisheye(v.cx, v.cy - 300, v)).toBeLessThan(fisheye(v.cx, v.cy - 100, v));
  });
});

describe('ringLayout', () => {
  const box = { left: -179, right: 179, top: -398, bottom: 270 }; // 375×812, 아래 입력 바
  it('오래된 순(입력 순)으로 이름표 둘레를 12시부터 시계방향, 고리가 차면 바깥 고리로', () => {
    for (const n of [7, 16, 34]) {
      const { pos } = ringLayout(n, box);
      const ang = (p: { x: number; y: number }) => (Math.atan2(p.x, -p.y) + 2 * Math.PI) % (2 * Math.PI);
      for (let i = 1; i < pos.length; i++) {
        const a = pos[i - 1]!, b = pos[i]!;
        expect(b.ring).toBeGreaterThanOrEqual(a.ring);
        if (b.ring === a.ring) expect(ang(b)).toBeGreaterThan(ang(a));
      }
      // 첫 카드는 첫 고리의 12시에 가장 가까운 칸(오른쪽 위)
      expect(pos[0]!.y).toBeLessThan(0);
      expect(pos[0]!.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('카드가 모두 상자 안, 서로·이름표와 겹치지 않는다', () => {
    for (const n of [1, 7, 16, 34, 60]) {
      const { k, pos } = ringLayout(n, box);
      expect(pos).toHaveLength(n);
      const cw = GLOBE.cardW * k, ch = GLOBE.cardH * k;
      for (const p of pos) {
        expect(p.x - cw / 2).toBeGreaterThanOrEqual(box.left - 4);
        expect(p.x + cw / 2).toBeLessThanOrEqual(box.right + 4);
        expect(p.y - ch / 2).toBeGreaterThanOrEqual(box.top - 4);
        expect(p.y + ch / 2).toBeLessThanOrEqual(box.bottom + 4);
        expect(Math.abs(p.x) >= (GLOBE.labelW + cw) / 2 - 4 || Math.abs(p.y) >= (GLOBE.labelH + ch) / 2 - 4).toBe(true);
      }
      for (let i = 0; i < pos.length; i++)
        for (let j = i + 1; j < pos.length; j++)
          expect(Math.abs(pos[i]!.x - pos[j]!.x) >= cw - 1 || Math.abs(pos[i]!.y - pos[j]!.y) >= ch - 1).toBe(true);
    }
  });

  it('작은 주제는 원래 크기, 큰 주제는 줄여서 담는다', () => {
    expect(ringLayout(7, box).k).toBe(GLOBE.ringScale);
    expect(ringLayout(34, box).k).toBeLessThan(1);
  });
});

describe('pickShown / ringCapacity (큰 주제는 최근 K개 + "+N", D18)', () => {
  const box = { left: -179, right: 179, top: -398, bottom: 270 };
  const memos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(2, '0')}`, createdAt: 1000 + i * 10 }));
  it('칸 수는 상한 이하이고 보통 카드 크기로 화면에 들어간다', () => {
    const cap = ringCapacity(box);
    expect(cap).toBeGreaterThan(1);
    expect(cap).toBeLessThanOrEqual(GLOBE.maxOpenCards);
    expect(ringLayout(cap, box).k).toBe(GLOBE.ringScale);
  });
  it('34개 → 가장 최근 K개를 오래된 순으로, N = 34 − K', () => {
    const cap = ringCapacity(box);
    const all = memos(34);
    const { shown, hidden } = pickShown([...all].reverse(), cap);
    const K = cap - 1;
    expect(shown).toHaveLength(K);
    expect(hidden).toBe(34 - K);
    expect(shown.map((m) => m.id)).toEqual(all.slice(34 - K).map((m) => m.id));
  });
  it('칸 수 이하이면 전부, "+N" 없음', () => {
    const cap = ringCapacity(box);
    for (const n of [1, 5, cap]) {
      const { shown, hidden } = pickShown(memos(n), cap);
      expect(shown).toHaveLength(n);
      expect(hidden).toBe(0);
    }
  });
});

describe('집중/하늘 보기 (D19)', () => {
  const pts = [{ lambda: 0 }, { lambda: 90 }, { lambda: 200 }, { lambda: -60 }];
  it('주제 경도에 멈추면 그 주제만 펼침 1, 나머지 0', () => {
    for (let i = 0; i < pts.length; i++) {
      const e = focusExpansion(pts[i]!.lambda, pts);
      expect(e[i]).toBe(1);
      expect(e.filter((_, j) => j !== i).every((v) => v === 0)).toBe(true);
    }
  });
  it('이웃으로 넘어가는 동안 떠나는 주제는 접히고 다가오는 주제는 펼쳐진다(연속, 감싸는 두 주제만)', () => {
    expect(bracket(30, pts)).toMatchObject({ a: 0, b: 1 });
    let prevA = 1, prevB = 0;
    for (let f = 0; f <= 90; f += 3) {
      const e = focusExpansion(f, pts);
      expect(e[0]!).toBeLessThanOrEqual(prevA + 1e-9);
      expect(e[1]!).toBeGreaterThanOrEqual(prevB - 1e-9);
      expect(e[2]).toBe(0);
      expect(e[3]).toBe(0);
      prevA = e[0]!;
      prevB = e[1]!;
    }
    const mid = focusExpansion(45, pts);
    expect(mid[0]!).toBeLessThan(0.1);
    expect(mid[1]!).toBeLessThan(0.1);
  });
  it('투명도: 하늘은 기본값, 집중은 펼친 주제 1·나머지 흐리게(≤ focusDim)', () => {
    expect(topicOpacity(0.8, 0, 0)).toBe(0.8);
    expect(topicOpacity(0.4, 0, 0)).toBe(0.4);
    expect(topicOpacity(1, 1, 1)).toBe(1);
    expect(topicOpacity(0.85, 0, 1)).toBeLessThanOrEqual(GLOBE.focusDim + 1e-9);
    expect(topicOpacity(0.4, 0, 1)).toBeLessThanOrEqual(GLOBE.focusDim);
    const half = topicOpacity(0.85, 0, 0.5);
    expect(half).toBeLessThan(0.85);
    expect(half).toBeGreaterThan(GLOBE.focusDim);
  });
});
