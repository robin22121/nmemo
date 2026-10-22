import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildExport,
  exportFileName,
  ImportError,
  NEWER_VERSION,
  NOT_EXPORT_FILE,
  parseExport,
  type Tables,
} from '../../src/core/exportImport';
import type { Link, Move, MoveBatch } from '../../src/core/types';
import { importBackup, prepareExport } from '../../src/db/backup';
import { KkeujeogimDB } from '../../src/db/schema';
import { mkMemo, mkTopic } from './memoryRepo';

// 내보내기·가져오기(Z3, 0단계 §4-2·§4-3)
let n = 0;
const freshDb = () => new KkeujeogimDB(`test-export-${n++}`);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 250, 251, 252, 253, 254, 255]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 0xff, 0xd9]);

async function seedFixture(db: KkeujeogimDB) {
  await db.topics.bulkAdd([mkTopic({ id: 't1', name: '마라톤' }), mkTopic({ id: 't2', name: 'Photos' })]);
  await db.memos.bulkAdd([
    mkMemo({ id: 'm1', topicId: 't1', organizedAt: 1000 }),
    mkMemo({ id: 'm2', topicId: 't1', lockedAt: 2000, topicLocked: true }),
    mkMemo({ id: 'p1', topicId: 't2', input: 'photo', photo: new Blob([PNG], { type: 'image/png' }) }),
    mkMemo({ id: 'p2', topicId: 't2', input: 'photo', photo: new Blob([JPEG], { type: 'image/jpeg' }) }),
    mkMemo({ id: 'q', status: 'pending' }),
  ]);
  await db.links.bulkAdd([{ id: 'm1|m2', fromId: 'm1', toId: 'm2', strength: 0.7, reason: '같은 대회' }]);
  await db.batches.bulkAdd([{ id: 'b1', topicId: 't1', at: 3000, prevName: '달리기', prevSummary: '', prevCenterKeywords: [], newName: '마라톤', moveCount: 1 }]);
  await db.moves.bulkAdd([{ id: 'mv1', batchId: 'b1', memoId: 'p1', fromTopicId: 't1', toTopicId: 't2', reason: '사진', at: 3000 }]);
}

const counts = async (db: KkeujeogimDB) => ({
  memos: await db.memos.count(),
  topics: await db.topics.count(),
  links: await db.links.count(),
  moves: await db.moves.count(),
  batches: await db.batches.count(),
});
const bytes = async (b: Blob | undefined) => [...new Uint8Array(await b!.arrayBuffer())];

describe('내보내기 → 빈 DB 가져오기(§4-2)', () => {
  let src: KkeujeogimDB;
  beforeEach(async () => {
    src = freshDb();
    await seedFixture(src);
  });

  it('테이블별 개수와 사진 바이트·type이 같고, 다시 가져오면 추가 0', async () => {
    const { name, text } = await prepareExport(true, new Date(2026, 9, 22, 9, 5), src);
    expect(name).toBe('끄적임-20261022-0905.json');
    const file = JSON.parse(text);
    expect([file.format, file.version]).toEqual(['kkeujeogim-export', 1]);
    expect(file.memos.find((m: { id: string }) => m.id === 'p1').photo).toMatch(/^data:image\/png;base64,/);

    const dst = freshDb();
    const r = await importBackup(text, dst);
    expect(r).toEqual({ memosAdded: 5, memosSkipped: 0, topicsAdded: 2, topicsMerged: 0 });
    expect(await counts(dst)).toEqual(await counts(src));
    for (const id of ['p1', 'p2']) {
      const a = (await src.memos.get(id))!.photo!;
      const b = (await dst.memos.get(id))!.photo!;
      expect(b).toBeInstanceOf(Blob);
      expect(b.type).toBe(a.type);
      expect(await bytes(b)).toEqual(await bytes(a));
    }
    expect((await dst.memos.get('p1'))!.photo!.type).toBe('image/png');
    expect(await dst.memos.get('m1')).toMatchObject({ topicId: 't1', organizedAt: 1000 });
    expect(await dst.memos.get('m2')).toMatchObject({ lockedAt: 2000, topicLocked: true });

    const again = await importBackup(text, dst);
    expect(again).toEqual({ memosAdded: 0, memosSkipped: 5, topicsAdded: 0, topicsMerged: 0 });
    expect(await counts(dst)).toEqual(await counts(src));
  });

  it('"사진 빼고"는 사진 필드가 없다', async () => {
    const { text } = await prepareExport(false, new Date(), src);
    const file = JSON.parse(text);
    expect(file.memos).toHaveLength(5);
    for (const m of file.memos) expect('photo' in m).toBe(false);
    expect(text.length).toBeLessThan((await prepareExport(true, new Date(), src)).text.length);
    const dst = freshDb();
    await importBackup(text, dst);
    expect((await dst.memos.get('p1'))?.photo).toBeUndefined();
  });
});

describe('형식 확인', () => {
  it('끄적임 파일이 아니면 분명한 말로 거절', () => {
    expect(() => parseExport('not json')).toThrow(NOT_EXPORT_FILE);
    expect(() => parseExport('{"memos":[]}')).toThrow(NOT_EXPORT_FILE);
    expect(() => parseExport(JSON.stringify({ format: 'kkeujeogim-export', version: 2 }))).toThrow(NEWER_VERSION);
    expect(() => parseExport(JSON.stringify({ format: 'kkeujeogim-export', version: 1, memos: [{}], topics: [], links: [], moves: [], batches: [] }))).toThrow(ImportError);
  });

  it('파일 이름은 끄적임-YYYYMMDD-HHmm.json', () => {
    expect(exportFileName(new Date(2026, 0, 3, 14, 7))).toBe('끄적임-20260103-1407.json');
  });
});

// §4-3: 이름이 같은 주제(공백·대소문자 차이)가 있는 두 파일
function fileText(t: Tables) {
  return JSON.stringify(buildExport(t, null, 0));
}
const batch = (id: string, topicId: string): MoveBatch => ({ id, topicId, at: 1, prevName: '', prevSummary: '', prevCenterKeywords: [], newName: '', moveCount: 1 });
const move = (id: string, batchId: string, memoId: string, fromTopicId: string, toTopicId: string): Move => ({ id, batchId, memoId, fromTopicId, toTopicId, reason: '', at: 1 });
const link = (a: string, b: string): Link => ({ id: `${a}|${b}`, fromId: a, toId: b, strength: 0.5, reason: '' });

const A = fileText({
  topics: [mkTopic({ id: 'ta-run', name: 'Running', createdAt: 10 }), mkTopic({ id: 'ta-only', name: '책', createdAt: 11 })],
  memos: [mkMemo({ id: 'a1', topicId: 'ta-run' }), mkMemo({ id: 'a2', topicId: 'ta-run' }), mkMemo({ id: 'a3', topicId: 'ta-only' }), mkMemo({ id: 'shared', topicId: 'ta-run' })],
  links: [link('a1', 'a2')],
  batches: [batch('ba', 'ta-run')],
  moves: [move('mva', 'ba', 'a3', 'ta-run', 'ta-only')],
});
const B = fileText({
  topics: [mkTopic({ id: 'tb-run', name: '  running ', createdAt: 20 }), mkTopic({ id: 'tb-only', name: '여행', createdAt: 21 })],
  memos: [mkMemo({ id: 'b1', topicId: 'tb-run' }), mkMemo({ id: 'b2', topicId: 'tb-only' }), mkMemo({ id: 'shared', topicId: 'tb-only' })],
  links: [link('b1', 'b2')],
  batches: [batch('bb', 'tb-run')],
  moves: [move('mvb', 'bb', 'b2', 'tb-run', 'tb-only')],
});

async function refsValid(db: KkeujeogimDB) {
  const topicIds = new Set((await db.topics.toArray()).map((t) => t.id));
  const memoIds = new Set((await db.memos.toArray()).map((m) => m.id));
  const batchIds = new Set((await db.batches.toArray()).map((b) => b.id));
  for (const m of await db.memos.toArray()) if (m.topicId !== undefined) expect(topicIds.has(m.topicId), `memo ${m.id}`).toBe(true);
  for (const mv of await db.moves.toArray()) {
    expect(topicIds.has(mv.fromTopicId) && topicIds.has(mv.toTopicId) && memoIds.has(mv.memoId) && batchIds.has(mv.batchId), `move ${mv.id}`).toBe(true);
  }
  for (const b of await db.batches.toArray()) expect(topicIds.has(b.topicId), `batch ${b.id}`).toBe(true);
  for (const l of await db.links.toArray()) expect(memoIds.has(l.fromId) && memoIds.has(l.toId), `link ${l.id}`).toBe(true);
}

describe('두 파일 합치기(§4-3)', () => {
  it('A→B와 B→A의 결과가 같고, 이름이 같은 주제는 하나로 합쳐지며 참조가 모두 유효', async () => {
    const ab = freshDb();
    const r1 = await importBackup(A, ab);
    const r2 = await importBackup(B, ab);
    const ba = freshDb();
    expect(await importBackup(B, ba)).toEqual({ memosAdded: 3, memosSkipped: 0, topicsAdded: 2, topicsMerged: 0 });
    const r4 = await importBackup(A, ba);

    expect(r1).toEqual({ memosAdded: 4, memosSkipped: 0, topicsAdded: 2, topicsMerged: 0 });
    expect(r2).toEqual({ memosAdded: 2, memosSkipped: 1, topicsAdded: 1, topicsMerged: 1 });
    expect([r4.topicsMerged, r4.memosSkipped]).toEqual([1, 1]);

    expect(await counts(ab)).toEqual(await counts(ba));
    expect(await counts(ab)).toMatchObject({ topics: 3, memos: 6, links: 2, batches: 2, moves: 2 });
    for (const db of [ab, ba]) {
      const runs = (await db.topics.toArray()).filter((t) => t.name.trim().toLowerCase() === 'running');
      expect(runs).toHaveLength(1);
      const run = runs[0]!.id;
      // 두 파일의 running 메모가 모두 한 주제에
      for (const id of ['a1', 'a2', 'b1']) expect((await db.memos.get(id))?.topicId).toBe(run);
      // 이동 기록·묶음의 주제 참조도 바뀌어 있다
      expect((await db.batches.toArray()).every((b) => b.topicId === run)).toBe(true);
      await refsValid(db);
    }
    // 먼저 들어온 쪽이 남는다(같은 id = 같은 메모)
    expect((await ab.memos.get('shared'))?.topicId).toBe('ta-run');
    expect((await ba.memos.get('shared'))?.topicId).toBe('tb-only');
  });
});
