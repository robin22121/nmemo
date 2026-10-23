import type { LayoutInput } from './clusters';

/**
 * 지구본 보드(앱의 보드 화면)의 배치·투영 상수(D35: 화면 안의 작은 지구본). 폰에서 느낌을 보며 손으로 조절한다.
 * 각도는 모두 도(°) 단위. 주제는 구 표면 위 점(경도 λ, 위도 β), 구는 세로축으로만 돈다(φ). 카메라는 고정 기울기 tilt.
 */
export const GLOBE = {
  /** 위도 층(±50° 안). 주제가 bands4From개 미만이면 3층, 그 이상이면 4층. 층마다 경도는 고르게 */
  bands3: [-32, 0, 32],
  bands4: [-42, -14, 14, 42],
  bands4From: 8,
  /** 고정 기울기: 위에서 살짝 내려다본다(북쪽이 조금 보인다) */
  tilt: 12,
  /** 구 반지름 = 화면 폭/2 − sideMargin(높이가 모자라면 높이로) */
  sideMargin: 18,
  /** 깊이 z(1 앞 · 0 테두리 · −1 뒤)에 따른 크기와 투명도. 정사영이라 위치는 그대로, 크기·투명도만 z로 */
  scaleFront: 1,
  scaleLimb: 0.6,
  scaleBack: 0.45,
  opacityFront: 1,
  opacityLimb: 0.55,
  opacityBack: 0.18,
  /** 이름표 기본 글자(px)와 최소 글자(px). 배율 × labelPx < labelMinPx이면 글자를 숨기고 점만 */
  labelPx: 15,
  labelMinPx: 11,
  /** 구 가장자리: |x − cx| > labelEdge·R이면 글자를 숨긴다 */
  labelEdge: 0.8,
  /** 이름표끼리 이만큼(px) 떨어져야 둘 다 글자. 겹치면 뒤쪽(z 작은) 것을 점으로 */
  labelGap: 2,
  /** 펼친 거품 둘레 여유(px): 뒤 지구본 이름표가 이 안에 들면 글자를 숨긴다 */
  cardGap: 4,
  /** 집중 상태(D19·D31): 뒤 지구본 투명도 배수(D28 0.55). 크기·자리는 SPLIT(D37) */
  focusDim: 0.55,
  /** 펼침: 화면 중심에서 이 각도 안이면 다 펼침(1), 이 각도 밖이면 이름표+점(0). 사이는 부드럽게 */
  expandFull: 8,
  expandNone: 35,
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
 * 위도 층 × 경도 균등으로 점 n개(결정론). 경도는 360/n 간격 격자(i·360/n)이고, 층마다 둘레(cos β)에 비례한 개수를
 * 고르게 번갈아 나눠 준다 → 층 안에서도 경도가 거의 고르고, 층끼리는 엇갈려 세로로 줄 서지 않는다.
 */
export function bandPoints(n: number): { lambda: number; beta: number }[] {
  const bands = n >= GLOBE.bands4From ? GLOBE.bands4 : GLOBE.bands3;
  const w = bands.map((b) => Math.cos(b * RAD));
  const sum = w.reduce((a, b) => a + b, 0);
  // 가장 큰 나머지 방식으로 층별 개수
  const raw = w.map((x) => (n * x) / sum);
  const cnt = raw.map(Math.floor);
  const order = raw.map((_, i) => i).sort((a, b) => raw[b]! - cnt[b]! - (raw[a]! - cnt[a]!) || w[b]! - w[a]! || a - b);
  for (let k = 0, left = n - cnt.reduce((a, b) => a + b, 0); k < left; k++) cnt[order[k % order.length]!]!++;
  // 경도 격자를 차례로 돌며, 지금까지 받은 비율이 가장 낮은 층에 준다
  const got = bands.map(() => 0);
  const pts: { lambda: number; beta: number }[] = [];
  for (let i = 0; i < n; i++) {
    let b = -1;
    for (let j = 0; j < bands.length; j++) {
      if (got[j]! >= cnt[j]!) continue;
      if (b < 0 || (got[j]! + 0.5) / cnt[j]! < (got[b]! + 0.5) / cnt[b]!) b = j;
    }
    got[b]!++;
    pts.push({ lambda: wrapDeg((i * 360) / n), beta: bands[b]! });
  }
  return pts;
}

/**
 * 주제마다 구 위 점(λ, β)을 정한다. 같은 입력이면 같은 결과.
 * 1) 위도 3~4층(±50° 안)에 경도를 고르게 나눠 점 n개를 찍는다(bandPoints).
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

  // 점: 1~2개는 정면과 그 옆(뒷면 아님), 그 이상은 위도 층 × 경도 균등
  const pts: { lambda: number; beta: number }[] = [];
  if (n <= 2) {
    pts.push({ lambda: 0, beta: 0 });
    if (n === 2) pts.push({ lambda: 60, beta: 20 });
  } else pts.push(...bandPoints(n));
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

/** 구 중심(cx, cy)과 반지름 r(화면 px) */
export interface GlobeViewport { cx: number; cy: number; r: number }

/**
 * 화면 크기 → 구. 중심은 아래 + 버튼 자리(reserve)를 뺀 위쪽 공간의 가운데, 반지름은 화면 폭/2 − sideMargin.
 * 크기를 못 쟀으면(0) 반지름 0(NaN 없음).
 */
export function globeViewport(width: number, height: number, reserve = 0): GlobeViewport {
  const avail = Math.max(0, height - reserve);
  const r = Math.max(0, Math.min(width / 2 - GLOBE.sideMargin, avail / 2 - GLOBE.sideMargin));
  return { cx: width / 2, cy: avail / 2, r };
}

export interface Projection {
  x: number;
  y: number;
  /** 깊이: 1 정면(구 중심 앞), 0 테두리, −1 뒷면 */
  z: number;
  scale: number;
  opacity: number;
  /** λ−φ (-180, 180] */
  delta: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 깊이 z → 크기(앞 1, 테두리 scaleLimb, 뒤 scaleBack) */
export function depthScale(z: number): number {
  return z >= 0 ? lerp(GLOBE.scaleLimb, GLOBE.scaleFront, z) : lerp(GLOBE.scaleLimb, GLOBE.scaleBack, -z);
}

/** 깊이 z → 투명도(앞 1, 테두리 opacityLimb, 뒤 opacityBack) */
export function depthOpacity(z: number): number {
  return z >= 0 ? lerp(GLOBE.opacityLimb, GLOBE.opacityFront, z) : lerp(GLOBE.opacityLimb, GLOBE.opacityBack, -z);
}

/**
 * 구 위 점(λ, β)을 세로축 회전 φ와 고정 기울기 tilt로 돌린 뒤 정사영한다.
 * φ가 줄면 앞면 주제는 왼쪽 → 오른쪽으로 흐른다(왼쪽 테두리에서 나타나 오른쪽 테두리에서 사라짐). 뒷면은 반대로 흐른다.
 */
export function projectGlobe(lambda: number, beta: number, phi: number, vp: GlobeViewport): Projection {
  const delta = wrapDeg(lambda - phi);
  const cb = Math.cos(beta * RAD), sb = Math.sin(beta * RAD);
  const x1 = cb * Math.sin(delta * RAD);
  const y1 = sb;
  const z1 = cb * Math.cos(delta * RAD);
  const ct = Math.cos(GLOBE.tilt * RAD), st = Math.sin(GLOBE.tilt * RAD);
  const y2 = y1 * ct - z1 * st;
  const z = Math.max(-1, Math.min(1, y1 * st + z1 * ct));
  return { x: vp.cx + vp.r * x1, y: vp.cy - vp.r * y2, z, scale: depthScale(z), opacity: depthOpacity(z), delta };
}

/** 화면 상자(px) */
export interface ScreenBox { l: number; t: number; r: number; b: number }

export interface LabelCand {
  x: number;
  y: number;
  z: number;
  /** 이름표 배율(글자 = labelPx × scale) */
  scale: number;
  /** 배율 1일 때 이름표 폭·높이(px) */
  w: number;
  h: number;
}

const overlap = (a: ScreenBox, b: ScreenBox, gap: number) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap;

/** 이름표 상자(화면 px): 점 (x, y)가 가운데 */
export function labelBox(c: LabelCand): ScreenBox {
  const hw = (c.w * c.scale) / 2, hh = (c.h * c.scale) / 2;
  return { l: c.x - hw, t: c.y - hh, r: c.x + hw, b: c.y + hh };
}

/**
 * 어느 주제의 이름표 글자를 보일지(나머지는 점만). 앞면(z > 0)이고 글자 ≥ labelMinPx이고 구 가장자리(|x − cx| > labelEdge·R)가 아닌 것.
 * 가까운(z 큰) 것부터 놓으며 이미 놓인 이름표나 막는 상자(block: 펼친 카드)와 겹치면 점으로 접는다.
 */
export function planLabels(cands: LabelCand[], vp: GlobeViewport, block: ScreenBox[] = []): boolean[] {
  const out = cands.map(() => false);
  const idx = cands.map((_, i) => i).sort((a, b) => cands[b]!.z - cands[a]!.z || a - b);
  const placed: ScreenBox[] = [];
  for (const i of idx) {
    const c = cands[i]!;
    if (c.z <= 0 || c.scale * GLOBE.labelPx < GLOBE.labelMinPx - 1e-6) continue;
    if (Math.abs(c.x - vp.cx) > GLOBE.labelEdge * vp.r) continue;
    const box = labelBox(c);
    if (placed.some((p) => overlap(p, box, GLOBE.labelGap))) continue;
    if (block.some((p) => overlap(p, box, 0))) continue;
    placed.push(box);
    out[i] = true;
  }
  return out;
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
 * 펼친 상태 = 위아래 나누기(D37). 구는 아래(+ 버튼 위)로 내려가 작아지고, 펼친 주제 이름은 위쪽 제목 자리,
 * 메모는 구 위쪽을 감싸는 타원 호(아치)에 둥근 거품으로 놓인다. 폰에서 느낌을 보며 손으로 조절한다.
 */
export const SPLIT = {
  /** 펼친 상태 구 반지름(px). 화면이 좁으면 하늘 상태 반지름을 넘지 않는다 */
  globeR: 140,
  /** 구 아래 끝과 + 버튼 자리 사이 틈(px) */
  globeGap: 8,
  /** 제목(펼친 주제 이름) 중심 = 위 safe-area + titleTop */
  titleTop: 30,
  /** 거품은 제목 중심에서 이만큼 아래부터(제목 글자와 안 겹침) */
  titleClear: 22,
  /** 아치 각도 범위(±, 위 방향 0°에서) */
  arcDeg: 62,
  /** 거품 지름(px) 범위와 거품 사이 간격 */
  dMax: 108,
  dMin: 76,
  gap: 8,
  /** 첫 줄 아치 세로 반지름 = 구 r + 거품 반지름 + rowLift */
  rowLift: 24,
  /** 아치 가로 반지름 ≤ 화면 폭/2 − 거품 반지름 − sideMargin */
  sideMargin: 12,
  /** 거품과 구 사이 최소 틈(px): 호 끝 거품이 구에 닿으면 그 줄 아치를 세로로 늘린다 */
  globeClear: 8,
} as const;

/** 펼친 상태 화면 배치: 아래 구, 위 제목, 거품이 놓일 수 있는 범위 */
export interface SplitGeom {
  w: number;
  globe: GlobeViewport;
  title: { x: number; y: number };
  /** 거품 위 끝이 이 y보다 아래 */
  top: number;
}

/**
 * 화면 크기 → 펼친 상태 배치. reserve = 아래 + 버튼 자리(bottomPad + 아래 safe-area), insetTop = 위 safe-area.
 * 구 중심은 가로 가운데, 구 아래 끝이 + 버튼 자리 위 globeGap. 크기를 못 쟀으면(0) 반지름 0.
 */
export function splitGeom(width: number, height: number, reserve = 0, insetTop = 0): SplitGeom {
  const avail = Math.max(0, height - reserve);
  const r = Math.max(0, Math.min(SPLIT.globeR, width / 2 - GLOBE.sideMargin, avail / 2 - GLOBE.sideMargin));
  const cy = width && height ? avail - r - SPLIT.globeGap : 0;
  const ty = insetTop + SPLIT.titleTop;
  return { w: width, globe: { cx: width / 2, cy, r }, title: { x: width / 2, y: ty }, top: ty + SPLIT.titleClear };
}

export interface ArchSpot { x: number; y: number; row: number }

/**
 * 타원 호 위 거품 자리의 반각들: θ=0(위) 둘레로 좌우 대칭, 이웃 중심 거리(현) = d + gap, ±arcDeg 안. 홀수 줄이면 0부터,
 * 짝수 줄이면 가운데 두 개(±t0)부터. 최대 upTo개(반쪽 기준)
 */
function halfAngles(odd: boolean, d: number, rx: number, ry: number, upTo: number): number[] {
  const s = d + SPLIT.gap;
  const lim = SPLIT.arcDeg * RAD + 1e-9;
  const at = (t: number) => [rx * Math.sin(t), -ry * Math.cos(t)] as const;
  const half: number[] = [];
  if (odd) half.push(0);
  else {
    // 가운데 두 개: 좌우 대칭이라 현 = 2·rx·sin t
    if (s / (2 * rx) >= 1) return half;
    const t0 = Math.asin(s / (2 * rx));
    if (t0 > lim) return half;
    half.push(t0);
  }
  while (half.length < upTo) {
    const t0 = half[half.length - 1]!, [x0, y0] = at(t0);
    const dist = (t: number) => {
      const [x, y] = at(t);
      return Math.hypot(x - x0, y - y0);
    };
    let lo = t0, hi = t0 + Math.PI / 2;
    if (dist(hi) < s) break;
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (dist(mid) < s) lo = mid;
      else hi = mid;
    }
    if (hi > lim) break;
    half.push(hi);
  }
  return half;
}

/** 반각들 → 화면 자리(가운데부터 바깥으로: 0, −t1, +t1, …) */
function spotsOf(half: number[], rx: number, ry: number, cx: number, cy: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const t of half) {
    if (t === 0) out.push({ x: cx, y: cy - ry });
    else out.push({ x: cx - rx * Math.sin(t), y: cy - ry * Math.cos(t) }, { x: cx + rx * Math.sin(t), y: cy - ry * Math.cos(t) });
  }
  return out;
}

const byX = (a: { x: number }, b: { x: number }) => a.x - b.x;

/**
 * 한 줄 아치를 세로 반지름 base부터 ryMax까지 늘려 가며 훑는다(위 끝이 제목에 닿으면 거기까지).
 * 각 아치에서 가운데부터 바깥으로, 구·앞 줄 거품과 안 겹치는 데까지 센다. want개가 되는 첫 아치(want 없으면 가장 많이 담는 첫 아치)
 */
function scanRow(want: number, d: number, base: number, g: SplitGeom, prev: { x: number; y: number }[], ryMax = Infinity): { x: number; y: number }[] | null {
  const br = d / 2;
  const { cx, cy, r } = g.globe;
  const rx = g.w / 2 - br - SPLIT.sideMargin;
  if (rx <= 0) return null;
  const ok = (p: { x: number; y: number }) =>
    Math.hypot(p.x - cx, p.y - cy) >= r + br + SPLIT.globeClear - 1e-6 && prev.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= d + SPLIT.gap - 1e-6);
  const odds = Number.isFinite(want) ? [want % 2 === 1] : [true, false];
  const upTo = Number.isFinite(want) ? Math.ceil(want / 2) : 40;
  let best: { x: number; y: number }[] | null = null;
  for (let ry = base; ry <= ryMax + 1e-6 && cy - ry - br >= g.top; ry += 3) {
    for (const odd of odds) {
      const half = halfAngles(odd, d, rx, ry, upTo);
      // 가운데부터 바깥으로 이어서 맞는 데까지(좁은 아치에서는 좌우 짝끼리도 가까울 수 있어 같은 줄 거품끼리도 본다)
      const pos: { x: number; y: number }[] = [];
      for (const t of half) {
        const add = spotsOf([t], rx, ry, cx, cy);
        if (!add.every((p) => ok(p) && pos.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= d + SPLIT.gap - 1e-6)) || (add.length === 2 && add[1]!.x - add[0]!.x < d + SPLIT.gap - 1e-6)) break;
        pos.push(...add);
      }
      if (Number.isFinite(want)) {
        if (pos.length === want) return pos.sort(byX);
      } else if (!best || pos.length > best.length) best = pos;
    }
  }
  return best ? best.sort(byX) : null;
}

/** m개가 다 들어가는 한 줄 아치(없으면 null) */
const fitRow = (m: number, d: number, base: number, g: SplitGeom, prev: { x: number; y: number }[], ryMax?: number) => (m <= 0 ? [] : scanRow(m, d, base, g, prev, ryMax));

/** 지름 d에서 한 줄에 놓을 수 있는 최대 개수와 그 자리 */
const maxRow = (d: number, base: number, g: SplitGeom, prev: { x: number; y: number }[], ryMax?: number) => scanRow(Infinity, d, base, g, prev, ryMax) ?? [];

/** 첫 줄 아치 세로 반지름 기준값(D37: 구 r + 거품 반지름 + 24) */
const rowBase = (d: number, g: SplitGeom) => g.globe.r + d / 2 + SPLIT.rowLift;

/**
 * 첫 줄 아치의 세로 반지름 상한: 기준값부터 늘려 가며 ±arcDeg 끝까지 구에 막히지 않고 차는 첫 값.
 * 좁은 화면(가로 반지름 < 세로 반지름)에서는 기준값의 호 끝이 구에 닿아 조금 늘려야 한다. 이보다 더 늘리면 아치가 위로 솟는다
 */
function ryFull(d: number, g: SplitGeom): number {
  const br = d / 2;
  const { cx, cy, r } = g.globe;
  const rx = g.w / 2 - br - SPLIT.sideMargin;
  let ry = rowBase(d, g);
  for (; cy - ry - br >= g.top; ry += 3) {
    const half = halfAngles(true, d, rx, ry, 40);
    if (spotsOf(half, rx, ry, cx, cy).every((p) => Math.hypot(p.x - cx, p.y - cy) >= r + br + SPLIT.globeClear - 1e-6)) return ry;
  }
  return ry - 3;
}

export interface ArchLayout {
  /** 거품 지름(px) */
  d: number;
  /** 거품 중심(화면 px). 첫 줄 왼쪽 → 오른쪽, 그다음 둘째 줄 */
  pos: ArchSpot[];
}

/**
 * 두 줄 아치(지름 d). 첫 줄은 구를 감싸는 아치(세로 반지름 ryFull), 둘째 줄은 그 바로 바깥 동심 타원 호
 * (세로 반지름 = 첫 줄 + d + gap에서 첫 줄 거품과 안 겹치게 최대 d/2 더, 가로 반지름은 같은 화면폭 제한) — 그 이상 위로 솟게 늘리지 않는다.
 * 둘째 줄도 가운데부터 좌우로 이어 놓고 2개 이상, 그리고 3개 이상이거나 첫 줄보다 적을 때만 쓴다. n이 Infinity면 가장 많이 담는 배치
 */
function twoRows(n: number, d: number, g: SplitGeom): ArchSpot[] | null {
  let best: ArchSpot[] | null = null;
  const ry1 = ryFull(d, g), ry2 = ry1 + d + SPLIT.gap;
  // 첫 줄은 꽉 찬 아치(가장 많이 담는 개수, 홀짝 맞추려 하나 적은 것까지): 첫 줄이 덜 차 가운데만 남는 일이 없게
  const full = maxRow(d, ry1, g, [], ry1).length;
  for (let m1 = full; m1 >= Math.max(1, full - 1); m1--) {
    const first = fitRow(m1, d, ry1, g, [], ry1);
    if (!first || first.length >= n) continue;
    const second = Number.isFinite(n) ? fitRow(n - first.length, d, ry2, g, first, ry2 + d / 2) : maxRow(d, ry2, g, first, ry2 + d / 2);
    // 둘째 줄은 3개 이상이거나 첫 줄보다 적게(2+2처럼 네모로 쌓이지 않게), 그리고 2개 이상(가운데 홀로 뜬 거품 없게)
    if (!second || second.length < 2 || (second.length < 3 && second.length >= first.length)) continue;
    const pos = [...first.map((p) => ({ ...p, row: 0 })), ...second.map((p) => ({ ...p, row: 1 }))];
    if (Number.isFinite(n)) return pos;
    if (!best || pos.length > best.length) best = pos;
  }
  return best;
}

const archCache = new Map<string, { cap: number; d: number; layouts: Map<number, ArchLayout> }>();
const geomKey = (g: SplitGeom) => [g.w, g.globe.cx, g.globe.cy, g.globe.r, g.top].map((v) => v.toFixed(1)).join('|');

function archTable(g: SplitGeom) {
  const key = geomKey(g);
  let t = archCache.get(key);
  if (!t) {
    if (archCache.size > 8) archCache.clear();
    const most = twoRows(Infinity, SPLIT.dMin, g) ?? [];
    const one = maxRow(SPLIT.dMin, rowBase(SPLIT.dMin, g), g, [], ryFull(SPLIT.dMin, g));
    t = { cap: Math.max(1, most.length, one.length), d: SPLIT.dMin, layouts: new Map() };
    archCache.set(key, t);
  }
  return t;
}

/** 한 줄 아치에 m개가 다 들어가는 가장 큰 지름(세로 반지름은 제목 아래까지 키울 수 있다) */
function oneRowLayout(m: number, g: SplitGeom): ArchLayout | null {
  for (let d: number = SPLIT.dMax; d >= SPLIT.dMin; d -= 2) {
    const pos = fitRow(m, d, rowBase(d, g), g, []);
    if (pos) return { d, pos: pos.map((p) => ({ ...p, row: 0 })) };
  }
  return null;
}

/** 두 줄 아치에 m개가 들어가는 가장 큰 지름(above보다 큰 것만). 4px씩 줄여 본다(2px씩은 계산이 두 배인데 눈에 띄는 차이가 없다) */
function twoRowLayout(m: number, g: SplitGeom, above: number): ArchLayout | null {
  for (let d: number = SPLIT.dMax; d > above && d >= SPLIT.dMin; d -= 4) {
    const pos = twoRows(m, d, g);
    if (pos) return { d, pos };
  }
  return null;
}

/**
 * 거품 n개 배치(D37). 한 줄에 다 들어가는 가장 큰 지름(108 → 76)과 바깥 둘째 줄까지 쓰는 가장 큰 지름 중 더 큰 쪽(같으면 한 줄).
 * 한 번 두 줄이 된 뒤로는 메모가 늘어도 두 줄(한 줄로 돌아가 아치가 세로로 길게 솟지 않게). 메모가 늘 때 지름은 커지지 않는다.
 * archCapacity를 넘는 n은 받지 않는다(호출한 쪽이 최근 N개 + "+N"을 고른다). 같은 화면이면 1..capacity를 한 번에 정해 기억해 둔다
 */
export function archLayout(n: number, g: SplitGeom): ArchLayout {
  if (n <= 0 || !g.w || !g.globe.r) return { d: SPLIT.dMax, pos: [] };
  const t = archTable(g);
  if (!t.layouts.size) {
    let two = false;
    for (let m = 1; m <= t.cap; m++) {
      const one = two ? null : oneRowLayout(m, g);
      const dbl = twoRowLayout(m, g, one ? one.d : SPLIT.dMin - 1);
      if (dbl) two = true;
      // 정확히 m개 배치를 못 찾으면(홀짝) 가장 많이 담는 배치에서 앞쪽 m개
      t.layouts.set(m, dbl ?? one ?? oneRowLayout(m, g) ?? { d: SPLIT.dMin, pos: (twoRows(Infinity, SPLIT.dMin, g) ?? []).slice(0, m) });
    }
  }
  return t.layouts.get(Math.min(n, t.cap))!;
}

/** 펼친 주제에 한 번에 놓는 거품 수(지름 76, 두 줄까지). 넘치면 최근 N개 + "+N"(D18) */
export function archCapacity(g: SplitGeom): number {
  if (!g.w || !g.globe.r) return 1;
  return archTable(g).cap;
}
