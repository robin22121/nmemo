import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '../../src/core/layout/clusters';
import { angularDist, archCapacity, archLayout, bandPoints, depthOpacity, depthScale, expansion, GLOBE, globeViewport, labelBox, pickShown, placeTopics, planLabels, projectGlobe, snapYaw, SPLIT, splitGeom, wrapDeg } from '../../src/core/layout/globe';
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

describe('splitGeom / archLayout (D37 펼친 상태 = 위아래 나누기, 메모 거품 아치)', () => {
  // 390×844, 세이프 위 47·아래 34
  const g = splitGeom(W, H, MOTION.bottomPad + 34, 47);
  const plusTop = H - 34 - 8 - 52;
  const check = (n: number) => {
    const a = archLayout(n, g);
    const br = a.d / 2;
    for (const p of a.pos) {
      // 세이프 영역 안, 제목 아래, + 버튼 위
      expect(p.x - br).toBeGreaterThanOrEqual(0);
      expect(p.x + br).toBeLessThanOrEqual(W);
      expect(p.y - br).toBeGreaterThanOrEqual(g.top - 1e-6);
      expect(p.y + br).toBeLessThan(plusTop);
      // 구와 겹치지 않음
      expect(Math.hypot(p.x - g.globe.cx, p.y - g.globe.cy)).toBeGreaterThanOrEqual(g.globe.r + br);
      // 아치는 구 위쪽 ±62° 안(타원 중심 = 구 중심)
      expect(p.y).toBeLessThan(g.globe.cy);
    }
    for (let i = 0; i < a.pos.length; i++)
      for (let j = i + 1; j < a.pos.length; j++) expect(Math.hypot(a.pos[i]!.x - a.pos[j]!.x, a.pos[i]!.y - a.pos[j]!.y)).toBeGreaterThanOrEqual(a.d + SPLIT.gap - 0.01);
    return a;
  };
  it('구: 반지름 140, + 버튼 자리 위, 가로 가운데. 제목은 위 세이프 영역 아래', () => {
    expect(g.globe.r).toBe(140);
    expect(g.globe.cx).toBe(W / 2);
    expect(g.globe.cy + g.globe.r).toBeLessThanOrEqual(H - MOTION.bottomPad - 34);
    expect(g.title.y).toBeGreaterThan(47);
    expect(g.top).toBeGreaterThan(g.title.y);
  });
  it('크기 0이면 반지름 0, 거품 없음(NaN 없음)', () => {
    const z = splitGeom(0, 0, 70);
    expect(z.globe.r).toBe(0);
    expect(archLayout(5, z).pos).toEqual([]);
    expect(archCapacity(z)).toBe(1);
  });
  it('메모 1~5개: 한 줄 아치(구를 감싸는 높은 아치), 지름 76~108, 겹침 0, 좌우 대칭', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const a = check(n);
      expect(a.pos).toHaveLength(n);
      expect(a.pos.every((p) => p.row === 0)).toBe(true);
      expect(a.d).toBeGreaterThanOrEqual(SPLIT.dMin);
      expect(a.d).toBeLessThanOrEqual(SPLIT.dMax);
      const xs = a.pos.map((p) => p.x - g.globe.cx).sort((p, q) => p - q);
      for (let i = 0; i < xs.length; i++) expect(xs[i]! + xs[xs.length - 1 - i]!).toBeCloseTo(0, 6);
    }
    expect(archLayout(1, g).d).toBe(SPLIT.dMax);
  });
  it('메모가 많으면 거품이 작아지고 두 줄(바깥 둘째 줄). 390×844는 지름 76·두 줄로 8개까지', () => {
    const cap = archCapacity(g);
    expect(cap).toBe(8);
    expect(archLayout(6, g).pos.some((p) => p.row === 1)).toBe(true);
    const a = check(cap);
    expect(a.pos).toHaveLength(cap);
    expect(a.d).toBe(SPLIT.dMin);
    expect(new Set(a.pos.map((p) => p.row))).toEqual(new Set([0, 1]));
    // 둘째 줄은 첫 줄 바깥(위)
    const top0 = Math.min(...a.pos.filter((p) => p.row === 0).map((p) => p.y));
    const top1 = Math.min(...a.pos.filter((p) => p.row === 1).map((p) => p.y));
    expect(top1).toBeLessThan(top0);
    // 둘째 줄은 첫 줄 바로 바깥 동심 호: 첫 줄 위 끝에서 d + gap(+ 겹침 피하는 여유 d/2 이하)만큼만 위, 위로 솟지 않는다
    // 한 번 두 줄이 되면 계속 두 줄(아치가 다시 세로로 솟지 않게)
    for (let n = 6; n <= cap; n++) {
      const b = check(n);
      const r0 = b.pos.filter((p) => p.row === 0), r1 = b.pos.filter((p) => p.row === 1);
      // 각 줄의 타원 세로 반지름(중심 = 구 중심, 가로 반지름 = 화면폭 제한)
      const rx = W / 2 - b.d / 2 - SPLIT.sideMargin;
      const ryOf = (p: { x: number; y: number }) => (g.globe.cy - p.y) / Math.sqrt(1 - ((p.x - g.globe.cx) / rx) ** 2);
      const ry0 = ryOf(r0[0]!), ry1 = ryOf(r1[0]!);
      for (const p of r0) expect(ryOf(p)).toBeCloseTo(ry0, 3);
      for (const p of r1) expect(ryOf(p)).toBeCloseTo(ry1, 3);
      expect(ry1 - ry0).toBeGreaterThanOrEqual(b.d + SPLIT.gap - 1e-6);
      expect(ry1 - ry0).toBeLessThanOrEqual(b.d + SPLIT.gap + b.d / 2 + 1e-6);
      // 가운데 홀로 뜬 거품 없음: 둘째 줄은 2개 이상, 첫 줄은 둘째 줄만큼 이상 퍼진다
      expect(r1.length).toBeGreaterThanOrEqual(2);
      // 2+2처럼 네모로 쌓이지 않음: 둘째 줄은 3개 이상이거나 첫 줄보다 적다
      expect(r1.length >= 3 || r1.length < r0.length).toBe(true);
      expect(Math.max(...r0.map((p) => Math.abs(p.x - g.globe.cx)))).toBeGreaterThanOrEqual(Math.max(...r1.map((p) => Math.abs(p.x - g.globe.cx))) - 1e-6);
    }
    for (let n = 1; n <= cap; n++) expect(check(n).pos).toHaveLength(n);
    // 개수가 늘면 거품은 작아지기만 한다(같은 줄 수 안에서)
    expect(archLayout(1, g).d).toBeGreaterThanOrEqual(archLayout(6, g).d);
  });
  it('지름은 한 줄·두 줄 중 큰 쪽(같으면 한 줄): 메모 1 → 40개로 늘 때 지름이 커지지 않는다', () => {
    let prev = Infinity;
    for (let n = 1; n <= 40; n++) {
      const a = archLayout(n, g);
      expect(a.d).toBeLessThanOrEqual(prev);
      prev = a.d;
    }
  });
  it('넘치면 담을 수 있는 만큼만(호출한 쪽이 최근 N개 + "+N")', () => {
    const cap = archCapacity(g);
    expect(check(40).pos).toHaveLength(cap);
  });
  it('작은 화면(375×667)도 거품이 화면 안·구 밖', () => {
    const s2 = splitGeom(375, 667, MOTION.bottomPad);
    const a = archLayout(archCapacity(s2), s2);
    for (const p of a.pos) {
      expect(p.x - a.d / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + a.d / 2).toBeLessThanOrEqual(375);
      expect(p.y - a.d / 2).toBeGreaterThanOrEqual(s2.top - 1e-6);
      expect(Math.hypot(p.x - s2.globe.cx, p.y - s2.globe.cy)).toBeGreaterThanOrEqual(s2.globe.r + a.d / 2);
    }
  });
});

describe('pickShown (큰 주제는 최근 K개 + "+N", D18)', () => {
  const cap = 12;
  const memos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${String(i).padStart(2, '0')}`, createdAt: 1000 + i * 10 }));
  it('40개 → 가장 최근 K개를 오래된 순으로, N = 40 − K', () => {
    const all = memos(40);
    const { shown, hidden } = pickShown([...all].reverse(), cap);
    const K = cap - 1;
    expect(shown).toHaveLength(K);
    expect(hidden).toBe(40 - K);
    expect(shown.map((m) => m.id)).toEqual(all.slice(40 - K).map((m) => m.id));
  });
  it('칸 수 이하이면 전부, "+N" 없음', () => {
    for (const n of [1, 5, cap]) {
      const { shown, hidden } = pickShown(memos(n), cap);
      expect(shown).toHaveLength(n);
      expect(hidden).toBe(0);
    }
  });
});
