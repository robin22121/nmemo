import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { hashString, seeded } from './seededRandom';

/** 카드 하나가 차지하는 가로/세로 반지름(월드 px). 카드는 가로로 길어서 x를 늘려 배치한다. */
export const CARD_RX = 56;
export const CARD_RY = 41;
const SX = CARD_RX / CARD_RY;
/** 무리 반지름 계산에 쓰는 카드 바깥 반지름 */
export const CARD_R = CARD_RX;
const CLUSTER_PAD = 20;
const CLUSTER_GAP = 24;

export interface LayoutInput {
  topics: { id: string }[];
  memos: { id: string; topicId: string }[];
  links: { fromId: string; toId: string; strength: number }[];
}

export interface Layout {
  /** 무리 중심과 반지름(월드 좌표) */
  clusters: Record<string, { x: number; y: number; r: number }>;
  /** 카드 중심(월드 좌표) */
  cards: Record<string, { x: number; y: number; topicId: string }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const EMPTY_LAYOUT: Layout = { clusters: {}, cards: {}, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

interface CardNode extends SimulationNodeDatum { id: string; x: number; y: number }
interface ClusterNode extends SimulationNodeDatum { id: string; x: number; y: number; r: number }

/**
 * 2단계 force 배치.
 * 1) 무리 안: 카드는 자기 무리 중심(0,0)으로 약하게 당겨지고 서로 겹치지 않으며, 관련 카드끼리 약하게 이어진다.
 * 2) 무리 사이: 약한 반발 + 충돌(반지름+여백) + 중앙으로 약한 끌림 + 주제 사이 링크 강도만큼 가까이.
 * 시드 난수·고정 tick이라 같은 입력이면 같은 결과다. prev가 있으면 그 위치에서 몇십 tick만 다시 돌려
 * 기존 카드는 조금만 움직인다.
 */
export function computeLayout(input: LayoutInput, prev?: Layout): Layout {
  const byTopic = new Map<string, string[]>();
  for (const t of input.topics) byTopic.set(t.id, []);
  const topicOf = new Map<string, string>();
  for (const m of input.memos) {
    if (!byTopic.has(m.topicId)) continue;
    byTopic.get(m.topicId)!.push(m.id);
    topicOf.set(m.id, m.topicId);
  }
  const topicIds = [...byTopic.keys()].filter((id) => byTopic.get(id)!.length > 0).sort();
  if (topicIds.length === 0) return EMPTY_LAYOUT;

  // ---- 1단계: 무리 안 카드 배치 (무리 중심 기준 로컬 좌표) ----
  const local = new Map<string, { x: number; y: number }>(); // memoId → 로컬 좌표
  const radius = new Map<string, number>();
  for (const tid of topicIds) {
    const ids = byTopic.get(tid)!.slice().sort();
    const rnd = seeded(hashString(`cards:${tid}`));
    const spread = CARD_RY * Math.sqrt(ids.length) * 1.0;
    const nodes: CardNode[] = ids.map((id) => {
      const p = prev?.cards[id];
      const pc = prev && p ? prev.clusters[p.topicId] : undefined;
      if (p && pc && p.topicId === tid) return { id, x: (p.x - pc.x) / SX, y: p.y - pc.y };
      const r2 = seeded(hashString(`card:${id}`));
      const ang = r2() * Math.PI * 2;
      const dist = Math.sqrt(r2()) * spread;
      return { id, x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
    });
    const idSet = new Set(ids);
    const links: SimulationLinkDatum<CardNode>[] = input.links
      .filter((l) => idSet.has(l.fromId) && idSet.has(l.toId))
      .map((l) => ({ source: l.fromId, target: l.toId, strength: l.strength }) as SimulationLinkDatum<CardNode>);
    const sim = forceSimulation<CardNode>(nodes)
      .randomSource(rnd)
      .alphaDecay(0)
      .velocityDecay(0.45)
      .force('x', forceX<CardNode>(0).strength(0.1))
      .force('y', forceY<CardNode>(0).strength(0.1))
      .force('charge', forceManyBody<CardNode>().strength(-6))
      .force('collide', forceCollide<CardNode>(CARD_RY).strength(0.9).iterations(2))
      .force(
        'link',
        forceLink<CardNode, SimulationLinkDatum<CardNode>>(links)
          .id((d) => d.id)
          .distance(CARD_RY * 2.2)
          .strength(0.04),
      )
      .stop();
    const warm = prev && nodes.every((n) => prev.cards[n.id]);
    sim.alpha(warm ? 0.15 : 1);
    const ticks = warm ? 30 : 100;
    for (let i = 0; i < ticks; i++) {
      sim.tick();
      if (!warm) sim.alpha(Math.max(0.05, 1 - (i / ticks) * 0.95));
    }
    // 무게중심을 0으로
    const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
    let maxD = 0;
    for (const n of nodes) {
      n.x -= cx;
      n.y -= cy;
      local.set(n.id, { x: n.x * SX, y: n.y });
      maxD = Math.max(maxD, Math.hypot(n.x * SX, n.y));
    }
    radius.set(tid, maxD + CARD_R * 0.9 + CLUSTER_PAD);
  }

  // ---- 2단계: 무리 중심 배치 ----
  const cn: ClusterNode[] = topicIds.map((id) => {
    const p = prev?.clusters[id];
    const r = radius.get(id)!;
    if (p) return { id, x: p.x, y: p.y, r };
    const rnd = seeded(hashString(`cluster:${id}`));
    const ang = rnd() * Math.PI * 2;
    // 새 무리는 기존 범위 바깥쪽 가장자리에서 시작해 안으로 들어온다
    const reach = prev && Object.keys(prev.clusters).length
      ? Math.max(...Object.values(prev.clusters).map((c) => Math.hypot(c.x, c.y) + c.r)) + r * 0.4
      : 120 + rnd() * 160;
    return { id, x: Math.cos(ang) * reach, y: Math.sin(ang) * reach, r };
  });
  const pair = new Map<string, number>();
  for (const l of input.links) {
    const a = topicOf.get(l.fromId);
    const b = topicOf.get(l.toId);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    pair.set(key, (pair.get(key) ?? 0) + l.strength);
  }
  const tl = [...pair.entries()].map(([k, w]) => {
    const [a, b] = k.split('|') as [string, string];
    return { source: a, target: b, w };
  });
  const csim = forceSimulation<ClusterNode>(cn)
    .randomSource(seeded(hashString('clusters:' + topicIds.join(','))))
    .alphaDecay(0)
    .velocityDecay(0.5)
    .force('charge', forceManyBody<ClusterNode>().strength(-30))
    .force('x', forceX<ClusterNode>(0).strength(0.04))
    .force('y', forceY<ClusterNode>(0).strength(0.022))
    .force('collide', forceCollide<ClusterNode>((d) => d.r + CLUSTER_GAP / 2).strength(1).iterations(3))
    .force(
      'link',
      forceLink<ClusterNode, { source: string; target: string; w: number }>(tl)
        .id((d) => d.id)
        .distance((l) => {
          const a = l.source as unknown as ClusterNode;
          const b = l.target as unknown as ClusterNode;
          return a.r + b.r + CLUSTER_GAP;
        })
        .strength((l) => Math.min(0.25, l.w * 0.03)),
    )
    .stop();
  const warm = !!prev && topicIds.every((id) => prev.clusters[id]);
  const ticks = warm ? 60 : 200;
  for (let i = 0; i < ticks; i++) {
    csim.alpha(warm ? 0.25 * (1 - i / ticks) + 0.02 : Math.max(0.03, 1 - i / ticks));
    csim.tick();
  }
  separate(cn);

  // ---- 결과 조립 ----
  const clusters: Layout['clusters'] = {};
  const cards: Layout['cards'] = {};
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cn) {
    clusters[c.id] = { x: round(c.x), y: round(c.y), r: round(c.r) };
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
    for (const id of byTopic.get(c.id)!) {
      const l = local.get(id)!;
      cards[id] = { x: round(c.x + l.x), y: round(c.y + l.y), topicId: c.id };
    }
  }
  return { clusters, cards, bounds: { minX, minY, maxX, maxY } };
}

/** force가 덜 풀어준 겹침을 결정적으로 밀어내 겹치지 않음을 보장한다 */
function separate(nodes: ClusterNode[]): void {
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!, b = nodes[j]!;
        const min = a.r + b.r + CLUSTER_GAP * 0.5;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; }
        const push = (min - d) / 2 + 0.01;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
