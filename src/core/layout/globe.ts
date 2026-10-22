import type { LayoutInput } from './clusters';
import { hashString } from './seededRandom';

/**
 * 지구본 보드(프로토타입 `?globe=1`)의 배치·투영 상수. 폰에서 느낌을 보며 손으로 조절한다.
 * 각도는 모두 도(°) 단위.
 */
export const GLOBE = {
  /** 주제 사이 경도 간격 범위 */
  minSpacing: 30,
  maxSpacing: 72,
  /** 한 위도 줄에 놓는 최대 주제 수. 넘으면 줄을 늘리고, 줄마다 경도를 간격/줄수만큼 엇갈려 둔다
   *  (같은 경도에 두면 정면에 무리 두 개가 겹쳐 보인다). 줄 안 간격은 [minSpacing, maxSpacing] 유지 */
  maxPerRow: 12,
  /** 한 줄일 때 이웃끼리 번갈아 쓰는 높이(위도) 3단과 주제별 흔들림 */
  betaLevels: [0, 22, -22] as readonly number[],
  betaJitter: 3,
  /** 여러 줄일 때 줄 높이 범위(±)와 이웃 경도끼리 엇갈리는 양 */
  rowBand: 20,
  rowAlt: 6,
  betaMax: 30,
  /** 화면 크기 대비 회전 반지름(가로)·위아래 폭·중심 높이 */
  rxFrac: 0.6,
  ryFrac: 0.3,
  cyFrac: 0.44,
  /** 크기: 정면, |Δ|=60°, 뒷면 */
  scaleFront: 1,
  scaleSide: 0.45,
  scaleBack: 0.3,
  /** 투명도: 정면, |Δ|=60°, |Δ|=90°, 뒷면 */
  opacityFront: 1,
  opacitySide: 0.55,
  opacityEdge: 0.2,
  opacityBack: 0.12,
  /** 이 각도 안이면 '정면' */
  frontDeg: 20,
  /** 무리 안 카드 간격 배수(지구본 카드는 글자가 커서 조금 넓힌다)와 카드 한 장의 가로·세로(px) */
  localSpread: 1.2,
  cardW: 128,
  cardH: 72,
} as const;

const RAD = Math.PI / 180;

/** 각도를 (-180, 180]으로 접는다 */
export function wrapDeg(d: number): number {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

export interface GlobePlace {
  /** 원 위 순서(링크가 강한 주제끼리 이웃) */
  order: string[];
  spacing: number;
  rows: number;
  topics: Record<string, { lambda: number; beta: number }>;
}

/**
 * 주제마다 경도 λ·위도 β를 정한다. 같은 입력이면 같은 결과.
 * 순서: 링크 합이 가장 큰 주제에서 시작해 끝에 가장 강하게 이어진 주제를 붙여 나가는 사슬.
 * 간격: 360/n을 [minSpacing, maxSpacing]로 묶고, 가운데 순번이 φ=0(정면)에 온다 → 1~2개면 정면과 +간격.
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
  if (n === 0) return { order: [], spacing: GLOBE.maxSpacing, rows: 1, topics: {} };

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

  const rows = Math.ceil(n / GLOBE.maxPerRow);
  const cols = Math.ceil(n / rows);
  const spacing = Math.min(GLOBE.maxSpacing, Math.max(GLOBE.minSpacing, 360 / cols));
  const mid = Math.floor((cols - 1) / 2);
  const levels = GLOBE.betaLevels;
  const topics: GlobePlace['topics'] = {};
  order.forEach((id, i) => {
    const jitter = ((hashString(`beta:${id}`) / 4294967295) * 2 - 1) * GLOBE.betaJitter;
    let beta: number;
    let col: number;
    let shift = 0;
    if (rows === 1) {
      col = i;
      // 원을 한 바퀴 돌아 처음과 이웃하는 마지막 주제도 높이가 다르게
      const li = n > 3 && n % levels.length === 1 && i === n - 1 ? 1 : i % levels.length;
      beta = n === 1 ? 0 : levels[li]! + jitter;
    } else {
      col = Math.floor(i / rows);
      const row = i % rows;
      shift = (spacing * row) / rows;
      beta = -GLOBE.rowBand + (2 * GLOBE.rowBand * row) / (rows - 1) + (col % 2 ? GLOBE.rowAlt : -GLOBE.rowAlt) + jitter;
    }
    beta = Math.max(-GLOBE.betaMax, Math.min(GLOBE.betaMax, beta));
    topics[id] = { lambda: wrapDeg((col - mid) * spacing + shift), beta: Math.round(beta * 10) / 10 };
  });
  return { order, spacing, rows, topics };
}

export interface GlobeViewport { cx: number; cy: number; rx: number; ry: number; zoom: number }

/** 화면 크기 → 투영 상수. zoom<1이면 지구본 전체를 작게(조망) */
export function globeViewport(width: number, height: number, zoom = 1): GlobeViewport {
  return { cx: width / 2, cy: height * GLOBE.cyFrac, rx: width * GLOBE.rxFrac * zoom, ry: height * GLOBE.ryFrac * zoom, zoom };
}

export interface Projection {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  /** 깊이 cos Δ: 1 정면, -1 뒷면. 겹침 순서로 쓴다 */
  z: number;
  /** λ−φ (-180, 180] */
  delta: number;
  side: 'front' | 'side' | 'back';
}

// |Δ|=60°에서 scaleSide가 나오도록 ((z+1)/2)^p 곡선의 지수를 정한다
const SCALE_POW = Math.log((GLOBE.scaleSide - GLOBE.scaleBack) / (GLOBE.scaleFront - GLOBE.scaleBack)) / Math.log(0.75);

/**
 * 구 위 점(λ, β)을 회전각 φ에서 화면에 투영한다. 뒷면(|Δ|>90°)은 sin Δ가 줄어드는 쪽이라
 * φ를 돌리면 앞면과 반대 방향으로 흐른다(내용은 뒤집지 않는다).
 */
export function projectGlobe(lambda: number, beta: number, phi: number, vp: GlobeViewport): Projection {
  const delta = wrapDeg(lambda - phi);
  const r = delta * RAD;
  const z = Math.cos(r);
  const x = vp.cx + vp.rx * Math.sin(r);
  const y = vp.cy - vp.ry * Math.sin(beta * RAD) * (0.6 + 0.4 * z);
  const scale = (GLOBE.scaleBack + (GLOBE.scaleFront - GLOBE.scaleBack) * Math.pow((z + 1) / 2, SCALE_POW)) * vp.zoom;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const opacity =
    z >= 0.5 ? lerp(GLOBE.opacitySide, GLOBE.opacityFront, (z - 0.5) / 0.5)
    : z >= 0 ? lerp(GLOBE.opacityEdge, GLOBE.opacitySide, z / 0.5)
    : lerp(GLOBE.opacityBack, GLOBE.opacityEdge, z + 1);
  const a = Math.abs(delta);
  return { x, y, scale, opacity, z, delta, side: a < GLOBE.frontDeg ? 'front' : a <= 90 ? 'side' : 'back' };
}

/** φ에서 가장 가까운 주제가 정면에 오는 φ(감기 없이 φ 근처 값). 주제가 없으면 φ 그대로 */
export function snapTarget(phi: number, lambdas: number[]): number {
  let best = phi;
  let bd = Infinity;
  for (const l of lambdas) {
    const d = wrapDeg(l - phi);
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = phi + d; }
  }
  return best;
}

/**
 * 무리 안 카드(로컬 좌표, 기존 d3 배치)를 지구본용으로 맞춘다: localSpread만큼 넓히고,
 * 가로가 maxHalfW를 넘으면 x를 줄인 뒤 겹치는 카드는 위아래로만 밀어낸다(가로 폭 유지 → 세로 스크롤).
 */
export function fitClusterCards(cards: { id: string; x: number; y: number }[], maxHalfW: number): { id: string; x: number; y: number }[] {
  const pts = cards.map((c) => ({ id: c.id, x: c.x * GLOBE.localSpread, y: c.y * GLOBE.localSpread }));
  const maxX = Math.max(0, ...pts.map((p) => Math.abs(p.x)));
  if (maxX <= maxHalfW) return pts;
  const k = Math.max(0, maxHalfW) / maxX;
  for (const p of pts) p.x *= k;
  pts.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
  const W = GLOBE.cardW, H = GLOBE.cardH;
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!, b = pts[j]!;
        const dy = b.y - a.y;
        if (Math.abs(b.x - a.x) >= W || Math.abs(dy) >= H) continue;
        const push = (H - Math.abs(dy)) / 2 + 0.01;
        const s = dy > 0 || (dy === 0 && a.id < b.id) ? 1 : -1;
        a.y -= push * s;
        b.y += push * s;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map((p) => ({ id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round((p.y - cy) * 10) / 10 }));
}
