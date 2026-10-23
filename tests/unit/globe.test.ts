import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '../../src/core/layout/clusters';
import { angularDist, bandPoints, depthOpacity, depthScale, expansion, GLOBE, globeViewport, labelBox, pickShown, placeTopics, planLabels, projectGlobe, ringCapacity, ringLayout, snapYaw, wrapDeg } from '../../src/core/layout/globe';
import { MOTION } from '../../src/ui/globe/config';
import { frontOf } from '../../src/ui/globe/engine';

function gen(nTopics: number, nMemos: number): LayoutInput {
  const topics = Array.from({ length: nTopics }, (_, i) => ({ id: `t${i}` }));
  const memos = Array.from({ length: nMemos }, (_, i) => ({ id: `m${i}`, topicId: `t${i % nTopics}` }));
  const links = Array.from({ length: nMemos }, (_, i) => ({ fromId: `m${i}`, toId: `m${(i * 5 + 3) % nMemos}`, strength: 0.5 }))
    .filter((l) => l.fromId !== l.toId);
  return { topics, memos, links };
}

// 390×844 아이폰, 아래 + 버튼 자리 bottomPad
const W = 390, H = 844;
const VP = globeViewport(W, H, MOTION.bottomPad);

function minSeparation(p: ReturnType<typeof placeTopics>): number {
  const ts = Object.values(p.topics);
  let m = Infinity;
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) m = Math.min(m, angularDist(ts[i]!.lambda, ts[i]!.beta, ts[j]!.lambda, ts[j]!.beta));
  return m;
}

describe('globeViewport (D35 화면 안의 작은 구)', () => {
  it('반지름 = 폭/2 − 18, 중심 = + 버튼 위 공간의 가운데, 구 전체가 화면 안', () => {
    expect(VP.r).toBe(W / 2 - 18);
    expect(VP.cx).toBe(W / 2);
    expect(VP.cy).toBe((H - MOTION.bottomPad) / 2);
    expect(VP.cy - VP.r).toBeGreaterThan(0);
    expect(VP.cy + VP.r).toBeLessThan(H - MOTION.bottomPad);
    expect(VP.cx - VP.r).toBeGreaterThan(0);
    expect(VP.cx + VP.r).toBeLessThan(W);
  });
  it('크기 0이면 반지름 0(NaN 없음)', () => {
    const v = globeViewport(0, 0, 70);
    expect(v).toEqual({ cx: 0, cy: 0, r: 0 });
    const q = projectGlobe(30, 10, 0, v);
    expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
  });
});

describe('placeTopics (위도 층 × 경도 균등)', () => {
  it('같은 입력이면 같은 결과', () => {
    expect(placeTopics(gen(6, 40))).toEqual(placeTopics(gen(6, 40)));
    expect(placeTopics(gen(30, 90))).toEqual(placeTopics(gen(30, 90)));
  });

  it('위도는 ±50° 안의 3~4층, 경도는 360/n 간격, 이웃끼리 떨어져 있다', () => {
    for (const [n, layers, sep] of [[3, 3, 40], [6, 3, 35], [9, 4, 28], [15, 4, 18], [30, 4, 10]] as const) {
      const p = placeTopics(gen(n, n * 3));
      const ts = Object.values(p.topics);
      expect(ts).toHaveLength(n);
      for (const t of ts) expect(Math.abs(t.beta)).toBeLessThanOrEqual(50);
      expect(new Set(ts.map((t) => t.beta)).size).toBe(layers);
      const ls = ts.map((t) => ((t.lambda % 360) + 360) % 360).sort((a, b) => a - b);
      for (let i = 0; i < n; i++) expect(Math.abs(((ls[(i + 1) % n]! - ls[i]! + 360) % 360) - 360 / n)).toBeLessThan(0.2);
      expect(minSeparation(p)).toBeGreaterThanOrEqual(sep);
    }
  });

  it('층마다 개수는 둘레에 비례하고, 층 안의 경도도 고르게 번갈아 나뉜다', () => {
    const pts = bandPoints(30);
    const by = new Map<number, number[]>();
    for (const p of pts) by.set(p.beta, [...(by.get(p.beta) ?? []), ((p.lambda % 360) + 360) % 360]);
    expect([...by.keys()].sort((a, b) => a - b)).toEqual([...GLOBE.bands4]);
    for (const [beta, ls] of by) {
      const k = ls.length;
      expect(k).toBeGreaterThanOrEqual(5);
      ls.sort((a, b) => a - b);
      const gaps = ls.map((l, i) => (((ls[(i + 1) % k]! - l + 360) % 360) || 360));
      // 같은 층 안 경도 간격: 고른 간격(360/k)에서 격자 2칸(24°) 안
      for (const g of gaps) expect(Math.abs(g - 360 / k)).toBeLessThanOrEqual((2 * 360) / 30 + 0.01);
      expect(Math.abs(beta)).toBeLessThanOrEqual(50);
    }
  });

  it('주제 1개는 정면, 2개는 정면과 옆(뒷면 아님)', () => {
    expect(Object.values(placeTopics(gen(1, 5)).topics)).toEqual([{ lambda: 0, beta: 0 }]);
    for (const t of Object.values(placeTopics(gen(2, 6)).topics)) expect(projectGlobe(t.lambda, t.beta, 0, VP).z).toBeGreaterThan(0);
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

describe('projectGlobe (정사영, 고정 기울기, 세로축 자전만)', () => {
  it('정면 적도 주제는 구 중심 바로 아래(기울기), 크기·투명도는 z로', () => {
    const q = projectGlobe(0, 0, 0, VP);
    expect(q.x).toBeCloseTo(VP.cx, 6);
    expect(q.y).toBeGreaterThan(VP.cy);
    expect(q.y - VP.cy).toBeCloseTo(VP.r * Math.sin((GLOBE.tilt * Math.PI) / 180), 6);
    // 위도 = 기울기인 점이 정확히 구 중심, z = 1
    const c = projectGlobe(40, GLOBE.tilt, 40, VP);
    expect(c.x).toBeCloseTo(VP.cx, 6);
    expect(c.y).toBeCloseTo(VP.cy, 6);
    expect(c.z).toBeCloseTo(1, 9);
    expect(c.scale).toBeCloseTo(1, 9);
    expect(c.opacity).toBeCloseTo(1, 9);
  });

  it('깊이 z가 클수록 크고 또렷하다(앞 1 · 테두리 · 뒤)', () => {
    let ps = depthScale(-1), po = depthOpacity(-1);
    for (let z = -0.9; z <= 1.0001; z += 0.1) {
      expect(depthScale(z)).toBeGreaterThan(ps);
      expect(depthOpacity(z)).toBeGreaterThan(po);
      ps = depthScale(z);
      po = depthOpacity(z);
    }
    expect(depthScale(1)).toBe(GLOBE.scaleFront);
    expect(depthScale(-1)).toBe(GLOBE.scaleBack);
    expect(depthOpacity(-1)).toBe(GLOBE.opacityBack);
  });

  it('모든 점은 늘 구 원판 안(어느 φ에서도)', () => {
    for (let phi = 0; phi < 360; phi += 7)
      for (const t of bandPoints(30)) {
        const q = projectGlobe(t.lambda, t.beta, phi, VP);
        expect(Math.hypot(q.x - VP.cx, q.y - VP.cy)).toBeLessThanOrEqual(VP.r + 1e-6);
      }
  });

  it('φ가 줄면(자전) 앞면 주제는 왼쪽 → 오른쪽, 뒷면은 오른쪽 → 왼쪽', () => {
    const dx = (lambda: number, beta: number) => projectGlobe(lambda, beta, -0.5, VP).x - projectGlobe(lambda, beta, 0.5, VP).x;
    for (const l of [0, 30, -45, 70]) expect(dx(l, 10)).toBeGreaterThan(0);
    for (const l of [120, 180, -130]) expect(dx(l, 10)).toBeLessThan(0);
  });
});

/** 이름표 크기(배율 1) 어림: 한글 글자 수 × 15px + 여백 */
const tagW = (i: number) => (3 + (i % 4)) * 15 + 20;
const TAG_H = 24;

describe('planLabels (이름표 글자)', () => {
  const cands = (phi: number, n = 30) =>
    bandPoints(n).map((t, i) => {
      const q = projectGlobe(t.lambda, t.beta, phi, VP);
      return { x: q.x, y: q.y, z: q.z, scale: q.scale, w: tagW(i), h: TAG_H };
    });

  it('② 30개: 어느 φ에서도 보이는 이름표끼리 겹치지 않고, 글자 ≥ 11px, 뒷면·가장자리는 글자 없음', () => {
    for (let phi = 0; phi < 360; phi += 2) {
      const cs = cands(phi);
      const on = planLabels(cs, VP);
      const boxes = cs.filter((_, i) => on[i]).map(labelBox);
      expect(boxes.length).toBeGreaterThan(3);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b).toBe(false);
        }
      cs.forEach((c, i) => {
        if (!on[i]) return;
        expect(c.scale * GLOBE.labelPx).toBeGreaterThanOrEqual(GLOBE.labelMinPx);
        expect(c.z).toBeGreaterThan(0);
        expect(Math.abs(c.x - VP.cx)).toBeLessThanOrEqual(GLOBE.labelEdge * VP.r);
      });
    }
  });

  it('막는 상자(펼친 카드)와 겹치는 이름표는 글자를 숨긴다', () => {
    const cs = cands(0);
    const all = planLabels(cs, VP);
    const block = [{ l: 0, t: 0, r: W, b: H / 2 }];
    const some = planLabels(cs, VP, block);
    expect(some.filter(Boolean).length).toBeLessThan(all.filter(Boolean).length);
    cs.forEach((c, i) => {
      if (some[i]) expect(labelBox(c).t).toBeGreaterThanOrEqual(H / 2);
    });
  });

  it('① 자동 자전 60초(2°/s): 점은 늘 구 안, 주제가 앞↔뒤로 바뀌거나 글자가 생기고 사라지는 곳은 구의 왼쪽·오른쪽(|x−cx| ≥ 0.5R)뿐, 앞면은 왼쪽에서 나타나 오른쪽으로 사라진다', () => {
    const pts = bandPoints(30);
    const fps = 30;
    let prev: { front: boolean; text: boolean; x: number }[] | null = null;
    let events = 0, phi = 0;
    for (let k = 0; k <= 60 * fps; k++) {
      const st = pts.map((t) => {
        const q = projectGlobe(t.lambda, t.beta, phi, VP);
        expect(Math.hypot(q.x - VP.cx, q.y - VP.cy)).toBeLessThanOrEqual(VP.r + 1e-6);
        // 글자 자격(겹침 접기 제외: 겹침은 점↔글자일 뿐 주제가 생기거나 사라지지 않는다)
        const text = q.z > 0 && q.scale * GLOBE.labelPx >= GLOBE.labelMinPx && Math.abs(q.x - VP.cx) <= GLOBE.labelEdge * VP.r;
        return { front: q.z > 0, text, x: q.x };
      });
      if (prev)
        st.forEach((s, i) => {
          const p = prev![i]!;
          if (s.front !== p.front || s.text !== p.text) {
            events++;
            expect(Math.abs(s.x - VP.cx)).toBeGreaterThanOrEqual(0.5 * VP.r);
            // 앞면이 되는(나타나는) 곳은 왼쪽, 뒷면이 되는(사라지는) 곳은 오른쪽
            if (s.front && !p.front) expect(s.x).toBeLessThan(VP.cx);
            if (!s.front && p.front) expect(s.x).toBeGreaterThan(VP.cx);
            if (s.text && !p.text) expect(s.x).toBeLessThan(VP.cx);
            if (!s.text && p.text) expect(s.x).toBeGreaterThan(VP.cx);
          }
        });
      prev = st;
      phi -= MOTION.boardAutorotate / fps;
    }
    // 60초에 120° 돌므로 바뀜이 실제로 있다(검사가 비지 않음)
    expect(events).toBeGreaterThan(20);
  });
});

describe('frontOf (정면 주제)', () => {
  it('앞면 중 가운데 세로줄에 가장 가까운 주제, 같으면 더 앞', () => {
    expect(frontOf([{ delta: 20, z: 0.9 }, { delta: -3, z: 0.5 }, { delta: 1, z: -0.2 }])).toBe(1);
    expect(frontOf([{ delta: 5, z: 0.5 }, { delta: -5, z: 0.8 }])).toBe(1);
    expect(frontOf([{ delta: 150, z: -0.5 }, { delta: 170, z: -0.9 }])).toBe(0);
    expect(frontOf([])).toBe(-1);
  });
  it('주제 경도에 멈추면 그 주제가 정면', () => {
    const pts = bandPoints(30);
    for (const t of pts) {
      const ps = pts.map((q) => ({ delta: wrapDeg(q.lambda - t.lambda), z: projectGlobe(q.lambda, q.beta, t.lambda, VP).z }));
      expect(pts[frontOf(ps)]).toBe(t);
    }
  });
});

describe('expansion / snapYaw', () => {
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
  });

  it('경도가 가장 가까운 주제로, φ는 감기 없이', () => {
    expect(snapYaw(350, [0, 60, 120])).toBe(360);
    expect(snapYaw(-25, [0, 60, -60])).toBe(0);
    expect(snapYaw(-35, [0, 60, -60])).toBe(-60);
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
