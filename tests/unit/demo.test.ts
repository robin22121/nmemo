import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/layout/clusters';
import { buildDemo, seedDemoIfEmpty } from '../../src/db/demoSeed';
import { initDb } from '../../src/db/schema';

describe('demo seed', () => {
  const d = buildDemo(1_700_000_000_000);

  it('메모 40개, 주제 5~6개, 네 가지 종류가 고르게', () => {
    expect(d.memos).toHaveLength(40);
    expect(d.topics.length).toBeGreaterThanOrEqual(5);
    expect(d.topics.length).toBeLessThanOrEqual(6);
    const kinds = new Map<string, number>();
    for (const m of d.memos) kinds.set(m.kind!, (kinds.get(m.kind!) ?? 0) + 1);
    expect([...kinds.keys()].sort()).toEqual(['emotion', 'idea', 'observation', 'todo']);
    for (const n of kinds.values()) expect(n).toBeGreaterThanOrEqual(7);
  });

  it('모든 메모가 존재하는 주제에 속하고 링크는 실제 메모를 가리킨다', () => {
    const topics = new Set(d.topics.map((t) => t.id));
    const memos = new Set(d.memos.map((m) => m.id));
    for (const m of d.memos) expect(topics.has(m.topicId!)).toBe(true);
    for (const l of d.links) {
      expect(memos.has(l.fromId) && memos.has(l.toId)).toBe(true);
      expect(l.strength).toBeGreaterThan(0);
      expect(l.strength).toBeLessThanOrEqual(1);
    }
    expect(d.links.length).toBeGreaterThan(30);
  });

  it('배치하면 무리가 겹치지 않는다', () => {
    const l = computeLayout({
      topics: d.topics,
      memos: d.memos.map((m) => ({ id: m.id, topicId: m.topicId! })),
      links: d.links,
    });
    const cs = Object.values(l.clusters);
    expect(cs).toHaveLength(d.topics.length);
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        expect(Math.hypot(cs[i]!.x - cs[j]!.x, cs[i]!.y - cs[j]!.y)).toBeGreaterThanOrEqual(cs[i]!.r + cs[j]!.r);
  });

  it('비어 있을 때만 DB에 넣는다', async () => {
    const db = initDb('test-demo-seed');
    expect(await seedDemoIfEmpty(db)).toBe(true);
    expect(await db.memos.count()).toBe(40);
    expect(await seedDemoIfEmpty(db)).toBe(false);
  });
});
