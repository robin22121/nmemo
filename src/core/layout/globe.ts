import type { LayoutInput } from './clusters';

/**
 * 지구본(천구) 보드(앱의 보드 화면)의 배치·투영 상수. 폰에서 느낌을 보며 손으로 조절한다.
 * 각도는 모두 도(°) 단위. 주제는 구 표면 위 점(경도 λ, 위도 β), 보는 방향은 (φ 좌우, θ 위아래).
 */
export const GLOBE = {
  /** 주제를 흩는 위도 범위(±). 화면 위아래 전체에 별처럼 퍼지게 */
  betaMax: 62,
  /** 시선 위아래 한계(극까지는 닿되 뒤집히지 않게). 끌기는 좌우만, 위아래는 주제 높이를 따라간다 */
  pitchMax: 70,
  /** 어안: 화면 중심에서 가장자리(타원 반지름 1)로 갈수록 배율이 fisheyeEdge까지 줄어든다 */
  fisheyeEdge: 0.65,
  fisheyeReach: 0.8,
  /** 화면 크기 대비 투영 반지름(가로·세로) */
  rxFrac: 0.62,
  ryFrac: 0.42,
  /** 크기: 정면, 60° 떨어짐, 뒷면 */
  scaleFront: 1,
  scaleSide: 0.45,
  scaleBack: 0.3,
  /** 투명도: 정면, 60°, 90°, 뒷면(105° 너머). 옆 이름표는 또렷하게, 뒷면도 흐리지만 보이게 */
  opacityFront: 1,
  opacitySide: 0.85,
  opacityEdge: 0.75,
  opacityBack: 0.4,
  /** 이 각도 안이면 '정면' */
  frontDeg: 20,
  /** 펼침: 화면 중심에서 이 각도 안이면 다 펼침(1), 이 각도 밖이면 이름표+점(0). 사이는 부드럽게 */
  expandFull: 8,
  expandNone: 35,
  /** 펼친 카드 칸(카드 한 장 + 틈, px)과 가운데 이름표 자리. 정면 카드 기본 크기 ringScale(촘촘하게) */
  cardW: 130,
  cardH: 66,
  gapX: 4,
  gapY: 6,
  labelW: 140,
  labelH: 40,
  ringScale: 0.88,
  /** 집중 보기에서 펼치지 않은 주제의 투명도(D19, D28에서 0.2 → 0.55)와, 이웃 주제로 넘어갈 때 펼침이 이어지는 구간(φ 진행 비율) */
  focusDim: 0.55,
  focusWindow: 0.55,
  /** 펼친 주제에 한 번에 놓는 카드 칸 상한(넘치면 최근 메모 + "+N", D18) */
  maxOpenCards: 12,
  /** 접힌 점 구름은 기존 무리 배치를 이만큼 줄여 쓴다 */
  dotSpread: 0.32,
} as const;

const RAD = Math.PI / 180;

/** 각도를 (-180, 180]으로 접는다 */
export function wrapDeg(d: number): number {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** 구 위 두 점 사이 각거리(°) */
export function angularDist(l1: number, b1: number, l2: number, b2: number): number {
  const c = Math.sin(b1 * RAD) * Math.sin(b2 * RAD) + Math.cos(b1 * RAD) * Math.cos(b2 * RAD) * Math.cos((l1 - l2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

export interface GlobePlace {
  /** 주제 순서(링크가 강한 주제끼리 이웃) */
  order: string[];
  topics: Record<string, { lambda: number; beta: number }>;
}

/**
 * 주제마다 구 위 점(λ, β)을 정한다. 같은 입력이면 같은 결과.
 * 1) 위도 ±betaMax 띠에 피보나치 나선으로 고르게 점 n개를 찍는다(이웃끼리 떨어짐, 위아래로 넓게).
 * 2) 정면(0,0)에 가장 가까운 점에서 시작해 가장 가까운 점을 이어 가는 길을 만든다.
 * 3) 링크가 강한 주제끼리 이웃하는 순서(사슬)를 그 길에 차례로 얹는다 → 관련 주제가 가까이.
 */
export function placeTopics(input: LayoutInput): GlobePlace {
  const count = new Map<string, number>();
  for (const t of input.topics) count.set(t.id, 0);
  const topicOf = new Map<string, string>();
  for (const m of input.memos) {
    if (!count.has(m.topicId)) continue;
    count.set(m.topicId, count.get(m.topicId)! + 1);
    topicOf.set(m.id, m.topicId);
  }
  const ids = [...count.keys()].filter((id) => count.get(id)! > 0).sort();
  const n = ids.length;
  if (n === 0) return { order: [], topics: {} };

  const w = new Map<string, number>();
  const total = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const l of input.links) {
    const a = topicOf.get(l.fromId), b = topicOf.get(l.toId);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    w.set(key, (w.get(key) ?? 0) + l.strength);
    total.set(a, total.get(a)! + l.strength);
    total.set(b, total.get(b)! + l.strength);
  }
  const weight = (a: string, b: string) => w.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;

  // 사슬: 링크 합이 가장 큰 주제에서 시작, 끝에 가장 강하게 이어진 주제를 붙인다
  const left = new Set(ids);
  let cur = ids.reduce((best, id) => (total.get(id)! > total.get(best)! ? id : best), ids[0]!);
  const order = [cur];
  left.delete(cur);
  while (left.size) {
    let next: string | null = null;
    let bw = -1;
    for (const id of ids) {
      if (!left.has(id)) continue;
      const v = weight(cur, id);
      if (v > bw) { bw = v; next = id; }
    }
    order.push(next!);
    left.delete(next!);
    cur = next!;
  }

  // 점: 1~2개는 정면과 그 옆(뒷면 아님), 그 이상은 위도 띠 안 피보나치 나선
  const pts: { lambda: number; beta: number }[] = [];
  if (n <= 2) {
    pts.push({ lambda: 0, beta: 0 });
    if (n === 2) pts.push({ lambda: 60, beta: 20 });
  } else {
    const zMax = Math.sin(GLOBE.betaMax * RAD);
    const golden = 180 * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const z = zMax * (1 - (2 * i) / (n - 1));
      pts.push({ lambda: wrapDeg(i * golden), beta: Math.asin(z) / RAD });
    }
  }
  // 길: 정면에 가장 가까운 점부터 가장 가까운 점으로
  const path: typeof pts = [];
  const rest = [...pts];
  let at = rest.reduce((b, p, i) => (angularDist(p.lambda, p.beta, 0, 0) < angularDist(rest[b]!.lambda, rest[b]!.beta, 0, 0) ? i : b), 0);
  while (rest.length) {
    const p = rest.splice(at, 1)[0]!;
    path.push(p);
    if (!rest.length) break;
    at = rest.reduce((b, q, i) => (angularDist(q.lambda, q.beta, p.lambda, p.beta) < angularDist(rest[b]!.lambda, rest[b]!.beta, p.lambda, p.beta) ? i : b), 0);
  }
  const topics: GlobePlace['topics'] = {};
  order.forEach((id, i) => {
    const p = path[i]!;
    topics[id] = { lambda: Math.round(p.lambda * 10) / 10, beta: Math.round(p.beta * 10) / 10 };
  });
  return { order, topics };
}

export interface GlobeViewport { cx: number; cy: number; rx: number; ry: number; zoom: number }

/** 화면 크기 → 투영 상수. 중심은 화면 정가운데. zoom<1이면 지구본 전체를 작게 */
export function globeViewport(width: number, height: number, zoom = 1): GlobeViewport {
  return { cx: width / 2, cy: height / 2, rx: width * GLOBE.rxFrac * zoom, ry: height * GLOBE.ryFrac * zoom, zoom };
}

export interface Projection {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  /** 깊이: 1 정면(화면 중심), -1 뒷면. 겹침 순서로 쓴다 */
  z: number;
  /** 화면 중심 방향과의 각거리(°) */
  dist: number;
  /** λ−φ (-180, 180] */
  delta: number;
  side: 'front' | 'side' | 'back';
}

// 60°에서 scaleSide가 나오도록 ((z+1)/2)^p 곡선의 지수를 정한다
const SCALE_POW = Math.log((GLOBE.scaleSide - GLOBE.scaleBack) / (GLOBE.scaleFront - GLOBE.scaleBack)) / Math.log(0.75);

/**
 * 구 위 점(λ, β)을 보는 방향(φ 좌우, θ 위아래)에서 화면에 투영한다.
 * 세로축으로 φ만큼, 가로축으로 θ만큼 돌린 뒤 정사영. 뒷면은 φ를 돌리면 앞면과 반대로 흐른다(내용은 안 뒤집음).
 */
export function projectGlobe(lambda: number, beta: number, phi: number, theta: number, vp: GlobeViewport): Projection {
  const delta = wrapDeg(lambda - phi);
  const cb = Math.cos(beta * RAD), sb = Math.sin(beta * RAD);
  const x1 = cb * Math.sin(delta * RAD);
  const y1 = sb;
  const z1 = cb * Math.cos(delta * RAD);
  const ct = Math.cos(theta * RAD), st = Math.sin(theta * RAD);
  const y2 = y1 * ct - z1 * st;
  const z = Math.max(-1, Math.min(1, y1 * st + z1 * ct));
  const x = vp.cx + vp.rx * x1;
  const y = vp.cy - vp.ry * y2;
  const scale = (GLOBE.scaleBack + (GLOBE.scaleFront - GLOBE.scaleBack) * Math.pow((z + 1) / 2, SCALE_POW)) * vp.zoom;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const opacity =
    z >= 0.5 ? lerp(GLOBE.opacitySide, GLOBE.opacityFront, (z - 0.5) / 0.5)
    : z >= 0 ? lerp(GLOBE.opacityEdge, GLOBE.opacitySide, z / 0.5)
    : lerp(GLOBE.opacityBack, GLOBE.opacityEdge, Math.max(0, 1 + 4 * z));
  const dist = Math.acos(z) / RAD;
  return { x, y, scale, opacity, z, dist, delta, side: dist < GLOBE.frontDeg ? 'front' : z >= 0 ? 'side' : 'back' };
}

/** 펼침 정도 e ∈ [0,1]: 화면 중심에서의 각거리에 대한 부드러운 함수 */
export function expansion(dist: number): number {
  const t = (GLOBE.expandNone - dist) / (GLOBE.expandNone - GLOBE.expandFull);
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** φ(감기 없이 φ 근처 값)에서 경도가 가장 가까운 주제가 정면에 오는 φ. 주제가 없으면 φ 그대로 */
export function snapYaw(phi: number, lambdas: number[]): number {
  let best = phi;
  let bd = Infinity;
  for (const l of lambdas) {
    const d = wrapDeg(l - phi);
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = phi + d; }
  }
  return best;
}

/**
 * 시선 높이 θ는 손가락이 아니라 φ에서 정해진다: 경도 순으로 이웃한 두 주제의 위도를 부드럽게(smoothstep) 잇는다.
 * 주제의 경도에 정확히 오면 그 주제의 위도 → 멈추면 이름표가 정가운데.
 */
export function pitchAt(phi: number, pts: { lambda: number; beta: number }[]): number {
  if (pts.length === 0) return 0;
  const clamp = (v: number) => Math.max(-GLOBE.pitchMax, Math.min(GLOBE.pitchMax, v));
  const { a, b, t } = bracket(phi, pts);
  const sm = t * t * (3 - 2 * t);
  return clamp(pts[a]!.beta + (pts[b]!.beta - pts[a]!.beta) * sm);
}

/** φ를 경도 순으로 감싸는 두 주제(원래 배열 인덱스 a, b)와 a→b 진행 정도 t ∈ [0,1) */
export function bracket(phi: number, pts: { lambda: number }[]): { a: number; b: number; t: number } {
  if (pts.length <= 1) return { a: 0, b: 0, t: 0 };
  const norm = (d: number) => ((d % 360) + 360) % 360;
  const idx = pts.map((_, i) => i).sort((p, q) => norm(pts[p]!.lambda) - norm(pts[q]!.lambda));
  const f = norm(phi);
  let k = idx.length - 1;
  for (let i = 0; i < idx.length; i++) if (norm(pts[idx[i]!]!.lambda) <= f) k = i;
  const a = idx[k]!, b = idx[(k + 1) % idx.length]!;
  const span = norm(pts[b]!.lambda - pts[a]!.lambda) || 360;
  return { a, b, t: Math.min(1, norm(f - norm(pts[a]!.lambda)) / span) };
}

const smooth01 = (x: number) => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/**
 * 집중 보기(D19)에서 펼침 e: 펼치는 건 φ를 감싸는 두 주제뿐. 떠나는 주제 a는 접히고 다가오는 주제 b는 펼쳐진다.
 * 겹치는 구간을 줄여(focusOverlap) 가운데쯤에서는 둘 다 거의 접힌다. 주제 경도에 멈추면 그 주제만 1, 나머지 0.
 */
export function focusExpansion(phi: number, pts: { lambda: number }[]): number[] {
  const out = pts.map(() => 0);
  if (pts.length === 0) return out;
  const { a, b, t } = bracket(phi, pts);
  const w = GLOBE.focusWindow;
  out[a] = smooth01((1 - t) / w - (1 - w) / w);
  if (b !== a) out[b] = Math.max(out[b]!, smooth01(t / w - (1 - w) / w));
  if (pts.length === 1) out[a] = 1;
  return out;
}

/**
 * 투명도(D17·D19). sky(f=0): 하늘 기본값 base. focus(f=1): 펼친 정도 e에 따라 dim → 1, 안 펼친 주제는 dim 이하로 흐리게.
 * f는 두 상태 사이를 오가는 진행값(0~1).
 */
export function topicOpacity(base: number, e: number, f: number): number {
  const low = Math.min(base, GLOBE.focusDim);
  const inFocus = low + (1 - low) * e;
  return base + (inFocus - base) * f;
}

/** 어안 배율: 화면 중심에서 가장 크고(1) 가장자리로 갈수록 작다. (x,y)는 화면 좌표 */
export function fisheye(x: number, y: number, vp: { cx: number; cy: number; width: number; height: number }): number {
  if (!(vp.width > 0) || !(vp.height > 0)) return 1; // 크기를 못 잰 상태: 0/0=NaN 방지
  const r = Math.hypot((x - vp.cx) / (vp.width / 2), (y - vp.cy) / (vp.height / 2));
  const t = Math.min(1, r / GLOBE.fisheyeReach);
  return 1 - (1 - GLOBE.fisheyeEdge) * t * t * (3 - 2 * t);
}

export interface RingBox { left: number; right: number; top: number; bottom: number }

/** 카드 크기 k에서 이름표 둘레 칸들(안쪽 고리부터, 같은 고리는 12시에서 시계방향 순) */
function ringCells(box: RingBox, k: number): { x: number; y: number; ring: number }[] {
  const w = (GLOBE.cardW + GLOBE.gapX) * k, h = (GLOBE.cardH + GLOBE.gapY) * k;
  const cw = GLOBE.cardW * k, ch = GLOBE.cardH * k;
  const cells: { x: number; y: number; ring: number; a: number }[] = [];
  const r0 = Math.ceil((box.top + ch / 2) / h), r1 = Math.floor((box.bottom - ch / 2) / h);
  for (let r = r0; r <= r1; r++) {
    const y = r * h;
    const off = (Math.abs(r) % 2) * 0.5;
    const j0 = Math.ceil((box.left + cw / 2) / w - off), j1 = Math.floor((box.right - cw / 2) / w - off);
    for (let j = j0; j <= j1; j++) {
      const x = (j + off) * w;
      // 이름표 자리는 비운다
      if (Math.abs(x) < (GLOBE.labelW + cw) / 2 && Math.abs(y) < (GLOBE.labelH + ch) / 2) continue;
      const ring = Math.max(1, Math.ceil(Math.max(Math.abs(x) / w, Math.abs(y) / h) - 1e-6));
      // 12시 = 0, 시계방향으로 증가(화면 y는 아래가 +)
      const a = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
      cells.push({ x: Math.round(x), y: Math.round(y), ring, a });
    }
  }
  cells.sort((p, q) => p.ring - q.ring || p.a - q.a);
  return cells.map(({ x, y, ring }) => ({ x, y, ring }));
}

/**
 * 펼친 주제에 한 번에 놓는 칸 수: 보통 카드 크기(ringScale)로 화면에 들어가는 칸 수와 maxOpenCards 중 작은 값.
 * 고정 상한을 두는 건 고리를 촘촘하게(둘레 하늘이 보이게) 유지하려는 것 — 큰 화면에서도 고리가 끝없이 커지지 않는다.
 */
export function ringCapacity(box: RingBox): number {
  return Math.max(1, Math.min(GLOBE.maxOpenCards, ringCells(box, GLOBE.ringScale).length));
}

/**
 * 펼친 주제에 보일 메모(D18): 다 들어가면 전부, 넘치면 최근 K개(K = 칸 수 − 1, 남은 한 칸은 "+N")만.
 * 보이는 것끼리는 오래된 것부터(D16 순서). hidden = 숨긴 수.
 */
export function pickShown<T extends { id: string; createdAt: number }>(items: T[], capacity: number): { shown: T[]; hidden: number } {
  const asc = [...items].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (asc.length <= capacity) return { shown: asc, hidden: 0 };
  const k = Math.max(0, capacity - 1);
  return { shown: asc.slice(asc.length - k), hidden: asc.length - k };
}

/**
 * 펼친 모양: 가운데 이름표 둘레 칸에 카드 n장을 놓는다. 칸은 엇갈린 격자(서로·이름표와 안 겹침)이고,
 * 안쪽 고리부터, 같은 고리 안에서는 12시 방향에서 시계방향 순. 카드를 생성 시각 순(오래된 것 먼저)으로 주면
 * 오래된 메모부터 이름표를 시계방향으로 둘러싸고, 고리가 차면 바깥 고리로 넘어간다.
 * 보통은 n ≤ ringCapacity라 카드 크기는 ringScale 그대로. 화면이 아주 작을 때만 k를 줄여 담는다.
 */
export function ringLayout(n: number, box: RingBox): { k: number; pos: { x: number; y: number; ring: number }[] } {
  for (let k: number = GLOBE.ringScale; ; k *= 0.94) {
    const cells = ringCells(box, k);
    if (cells.length >= n || k < 0.2) return { k: Math.round(k * 1000) / 1000, pos: cells.slice(0, n) };
  }
}
