/** 주제 모양 목록(F7). 정규화 꺾은선 0~1, DOM 없음. */

export type Pt = [number, number];
export type Polys = Pt[][];
export interface Box { x: number; y: number; w: number; h: number }
export interface Rect { l: number; t: number; r: number; b: number }

export const SHAPE_IDS = [
  'circle', 'wave', 'spiral', 'footprints', 'mountain', 'tree',
  'cup', 'star', 'moon', 'house', 'heart', 'cloud',
] as const;
export type ShapeId = (typeof SHAPE_IDS)[number];

/** F9: 이 수보다 적으면 모양 없이 카드만, 이 수보다 많으면 점을 작게 */
export const SHAPE_MIN_MEMOS = 3;
export const SHAPE_SMALL_DOT_ABOVE = 24;

const TAU = Math.PI * 2;

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** 작성용 좌표를 비율을 지킨 채 0~1 상자 가운데로 맞춘다 */
function fit(polys: Polys): Polys {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = x1 - x0, h = y1 - y0, s = Math.max(w, h) || 1;
  const ox = (1 - w / s) / 2, oy = (1 - h / s) / 2;
  return polys.map((p) => p.map(([x, y]): Pt => [ox + (x - x0) / s, oy + (y - y0) / s]));
}

function smooth(keys: Pt[], y: number): number {
  for (let i = 1; i < keys.length; i++) {
    if (y <= keys[i]![0]) {
      const [ya, wa] = keys[i - 1]!, [yb, wb] = keys[i]!;
      const u = (y - ya) / (yb - ya || 1);
      return wa + (wb - wa) * (1 - Math.cos(Math.PI * u)) / 2;
    }
  }
  return keys[keys.length - 1]![1];
}

/** 발바닥 하나(앞꿈치가 위, 안쪽이 -x): 발바닥 윤곽 + 발가락 5개 */
function foot(): Polys {
  const outer: Pt[] = [[0, 0], [0.05, 0.17], [0.15, 0.21], [0.4, 0.2], [0.65, 0.27], [0.78, 0.23], [0.84, 0.12], [0.87, 0]];
  const inner: Pt[] = [[0, 0], [0.05, 0.14], [0.15, 0.16], [0.4, 0.09], [0.62, 0.17], [0.76, 0.17], [0.82, 0.1], [0.85, 0]];
  const sole: Pt[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) { const y = (0.87 * i) / N; sole.push([smooth(outer, y), y]); }
  for (let i = N; i >= 0; i--) { const y = (0.85 * i) / N; sole.push([-smooth(inner, y), y]); }
  sole.push(sole[0]!);
  const toes: [number, number, number][] = [
    [-0.05, 1.03, 0.12], [0.12, 1.0, 0.078], [0.21, 0.94, 0.07], [0.27, 0.87, 0.063], [0.3, 0.8, 0.056],
  ];
  return [sole, ...toes.map(([cx, cy, r]) => arc(cx, cy, r, r, 0, TAU, 20))];
}

function placeFoot(p: Polys, mirror: boolean, scale: number, rot: number, dx: number, dy: number): Polys {
  const c = Math.cos(rot), s = Math.sin(rot);
  return p.map((poly) => poly.map(([x, y]): Pt => {
    const mx = (mirror ? -x : x) * scale, my = -y * scale; // 화면 y는 아래로 커진다 → 앞꿈치가 위
    return [dx + mx * c - my * s, dy + mx * s + my * c];
  }));
}

function moon(): Polys {
  const c1: Pt = [0.5, 0.5], r1 = 0.5, c2: Pt = [0.74, 0.4], r2 = 0.4;
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy), a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const d1 = Math.acos(a / r1), d2 = Math.acos((d - a) / r2);
  const phi2 = Math.atan2(dy, dx), phi1 = phi2 + Math.PI;
  const outer = arc(c1[0], c1[1], r1, r1, phi2 + d1, phi2 + TAU - d1, 60);
  const last = outer[outer.length - 1]!;
  const cand = [arc(c2[0], c2[1], r2, r2, phi1 + d2, phi1 - d2, 44), arc(c2[0], c2[1], r2, r2, phi1 - d2, phi1 + d2, 44)];
  const dist = (p: Pt) => Math.hypot(p[0] - last[0], p[1] - last[1]);
  const inner = dist(cand[0]![0]!) < dist(cand[1]![0]!) ? cand[0]! : cand[1]!;
  return [[...outer, ...inner, outer[0]!]];
}

function cloud(): Polys {
  const cs: [number, number, number][] = [[0.2, 0.62, 0.18], [0.4, 0.42, 0.24], [0.66, 0.45, 0.22], [0.82, 0.64, 0.16]];
  const base = 0.76;
  const ang = (c: [number, number, number], p: Pt) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  // 이웃한 두 원의 위쪽 교점
  const upper = (c1: [number, number, number], c2: [number, number, number]): Pt => {
    const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy);
    const a = (c1[2] ** 2 - c2[2] ** 2 + d * d) / (2 * d), h = Math.sqrt(c1[2] ** 2 - a * a);
    const mx = c1[0] + (a * dx) / d, my = c1[1] + (a * dy) / d;
    const p1: Pt = [mx + (h * dy) / d, my - (h * dx) / d], p2: Pt = [mx - (h * dy) / d, my + (h * dx) / d];
    return p1[1] < p2[1] ? p1 : p2;
  };
  const baseX = (c: [number, number, number], sign: number): Pt => [c[0] + sign * Math.sqrt(c[2] ** 2 - (base - c[1]) ** 2), base];
  const out: Pt[] = [];
  const first = cs[0]!, last = cs[cs.length - 1]!;
  let from: Pt = baseX(first, -1);
  cs.forEach((c, i) => {
    const to = i < cs.length - 1 ? upper(c, cs[i + 1]!) : baseX(last, 1);
    const a0 = ang(c, from);
    let a1 = ang(c, to);
    while (a1 <= a0) a1 += TAU;
    out.push(...arc(c[0], c[1], c[2], c[2], a0, a1, 24));
    from = to;
  });
  out.push(baseX(first, -1));
  return [out];
}

function build(id: ShapeId): Polys {
  switch (id) {
    case 'circle':
      return [arc(0.5, 0.5, 0.5, 0.5, -Math.PI / 2, (3 * Math.PI) / 2, 72)];
    case 'wave': {
      const line = (cy: number, ph: number): Pt[] => {
        const o: Pt[] = [];
        for (let i = 0; i <= 80; i++) { const x = i / 80; o.push([x, cy + 0.14 * Math.sin(x * TAU * 2 + ph)]); }
        return o;
      };
      return fit([line(0.25, 0), line(0.55, 0.7), line(0.85, 1.4)]);
    }
    case 'spiral': {
      const o: Pt[] = [];
      const turns = 2.75, N = 220;
      for (let i = 0; i <= N; i++) {
        const t = i / N, r = 0.04 + 0.46 * t, a = t * turns * TAU - Math.PI / 2;
        o.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
      }
      return fit([o]);
    }
    case 'footprints':
      return fit([
        ...placeFoot(foot(), false, 0.62, -0.18, 0.0, 1.0),
        ...placeFoot(foot(), true, 0.62, 0.18, 0.62, 0.5),
      ]);
    case 'mountain':
      return fit([
        [[0, 1], [0.28, 0.4], [0.42, 0.62], [0.68, 0.1], [1, 1], [0, 1]],
        [[0.58, 0.3], [0.63, 0.38], [0.68, 0.3], [0.72, 0.38], [0.75, 0.3]],
      ]);
    case 'tree':
      return fit([[
        [0.5, 0], [0.72, 0.3], [0.62, 0.3], [0.82, 0.56], [0.68, 0.56], [0.9, 0.82], [0.56, 0.82], [0.56, 1],
        [0.44, 1], [0.44, 0.82], [0.1, 0.82], [0.32, 0.56], [0.18, 0.56], [0.38, 0.3], [0.28, 0.3], [0.5, 0],
      ]]);
    case 'cup': {
      const body: Pt[] = [[0.1, 0.35], [0.7, 0.35], [0.66, 0.7], ...arc(0.4, 0.7, 0.26, 0.14, 0, Math.PI, 20).slice(1, -1), [0.14, 0.7], [0.1, 0.35]];
      const handle = arc(0.7, 0.52, 0.2, 0.16, -Math.PI / 2, Math.PI / 2, 24);
      const saucer: Pt[] = [[0.0, 0.9], [0.8, 0.9]];
      const steam = (x: number): Pt[] => {
        const o: Pt[] = [];
        for (let i = 0; i <= 24; i++) { const t = i / 24; o.push([x + 0.04 * Math.sin(t * TAU * 1.25), 0.28 - 0.28 * t]); }
        return o;
      };
      return fit([body, handle, saucer, steam(0.28), steam(0.52)]);
    }
    case 'star': {
      const o: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.21, a = -Math.PI / 2 + (i * Math.PI) / 5;
        o.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
      }
      return fit([o]);
    }
    case 'moon':
      return fit(moon());
    case 'house':
      return fit([
        [[0.05, 0.5], [0.5, 0.08], [0.95, 0.5], [0.82, 0.5], [0.82, 1], [0.18, 1], [0.18, 0.5], [0.05, 0.5]],
        [[0.43, 1], [0.43, 0.7], [0.57, 0.7], [0.57, 1]],
        [[0.7, 0.3], [0.7, 0.12], [0.78, 0.12], [0.78, 0.36]],
      ]);
    case 'heart': {
      const o: Pt[] = [];
      for (let i = 0; i <= 100; i++) {
        const t = (i / 100) * TAU;
        o.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
      }
      return fit([o]);
    }
    case 'cloud':
      return fit(cloud());
  }
}

const cache = new Map<string, Polys>();

/** 모양 id → 정규화 꺾은선. 모르는 id는 원. */
export function getShape(id: string | undefined): Polys {
  const key: ShapeId = (SHAPE_IDS as readonly string[]).includes(id ?? '') ? (id as ShapeId) : 'circle';
  let p = cache.get(key);
  if (!p) { p = build(key); cache.set(key, p); }
  return p;
}

export function isShapeId(v: unknown): v is ShapeId {
  return typeof v === 'string' && (SHAPE_IDS as readonly string[]).includes(v);
}

function alongOutline(polys: Polys, m: number): Pt[] {
  const segs: { a: Pt; b: Pt; start: number; len: number }[] = [];
  let total = 0;
  for (const poly of polys) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]!, b = poly[i]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 0) { segs.push({ a, b, start: total, len }); total += len; }
    }
  }
  const out: Pt[] = [];
  if (!segs.length || m <= 0) return out;
  let k = 0;
  for (let i = 0; i < m; i++) {
    const d = ((i + 0.5) / m) * total;
    while (k < segs.length - 1 && segs[k]!.start + segs[k]!.len < d) k++;
    const s = segs[k]!, u = Math.min(1, Math.max(0, (d - s.start) / s.len));
    out.push([s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u]);
  }
  return out;
}

/**
 * 윤곽을 따라 고르게 n개(순서 유지). avoid(상자와 같은 좌표계) 안의 점은 건너뛰고
 * 남은 윤곽에서 다시 고르게 n개를 뽑는다. 남은 점이 n보다 적으면 있는 만큼만 돌려준다.
 */
export function sampleShape(polys: Polys, n: number, box: Box, avoid?: Rect): Pt[] {
  if (!(n > 0)) return [];
  const toBox = ([x, y]: Pt): Pt => [box.x + x * box.w, box.y + y * box.h];
  if (!avoid) return alongOutline(polys, n).map(toBox);
  const inside = ([x, y]: Pt) => x >= avoid.l && x <= avoid.r && y >= avoid.t && y <= avoid.b;
  const cand = alongOutline(polys, Math.max(n * 8, 512)).map(toBox).filter((p) => !inside(p));
  if (cand.length <= n) return cand;
  return Array.from({ length: n }, (_, i) => cand[Math.floor(((i + 0.5) * cand.length) / n)]!);
}

/** 메모 점 위치: 시간순으로 윤곽을 따라(첫 메모가 윤곽의 시작쪽). */
export function memoPositions(shapeId: string | undefined, count: number, box: Box, avoid?: Rect): Pt[] {
  return sampleShape(getShape(shapeId), count, box, avoid);
}
