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
  /** 펼친 카드 둘레 여유(px): 뒤 지구본 이름표가 이 안에 들면 글자를 숨긴다 */
  cardGap: 4,
  /** 집중 상태(D19·D31): 뒤 지구본 반지름 배율과 투명도 배수(D28 0.55) */
  focusZoom: 0.72,
  focusDim: 0.55,
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
  /** 펼친 주제에 한 번에 놓는 카드 칸 상한(넘치면 최근 메모 + "+N", D18) */
  maxOpenCards: 12,
  /** 펼치기 전 카드가 모여 있는 자리: 기존 무리 배치를 이만큼 줄여 쓴다(펼칠 때 여기서 터져 나온다) */
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
