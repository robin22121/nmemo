import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyResult } from '../../src/core/organize/apply';
import { applyReorganize, undoReorganize } from '../../src/core/organize/reorganize';
import { DexieRepo } from '../../src/db/dexieRepo';
import { initDb } from '../../src/db/schema';
import { mkMemo, mkTopic } from './memoryRepo';

let n = 0;
beforeEach(() => { initDb(`test-dexie-${n++}`); });

describe('Dexie 스키마 v2', () => {
  it('v1 데이터는 업그레이드 때 재구성 필드가 채워진다', async () => {
    const name = `migrate-${n++}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ memos: 'id, createdAt, status, topicId', topics: 'id, createdAt', links: 'id, fromId, toId' });
    await v1.table('topics').add({ id: 't', name: '옛 주제', summary: '', color: '#fff', createdAt: 777 });
    v1.close();
    const db = initDb(name);
    const t = await db.topics.get('t');
    expect(t).toMatchObject({ centerKeywords: [], nameLocked: false, lastReorgAt: 777, sinceReorg: 0 });
    expect(await db.moves.count()).toBe(0);
  });
});

describe('DexieRepo + core', () => {
  it('정돈·재구성·되돌리기가 IndexedDB 위에서도 같게 동작한다', async () => {
    const repo = new DexieRepo();
    await repo.addTopic(mkTopic({ id: 'run', name: '마라톤', centerKeywords: ['마라톤'] }));
    await repo.addTopic(mkTopic({ id: 'person', name: '인물', centerKeywords: ['황영조'] }));
    await repo.addMemo(mkMemo({ id: 'hwang', topicId: 'run', keywords: ['황영조'] }));
    await repo.addMemo(mkMemo({ id: 'a', topicId: 'run' }));
    await repo.addMemo(mkMemo({ id: 'b', topicId: 'run' }));
    const out = await applyReorganize(repo, 'run', {
      topic: { name: '운동용품', summary: '', centerKeywords: ['용품'] },
      moves: [{ memoId: 'hwang', to: { existingId: 'person' }, fit: 0.9, reason: '인물' }],
    }, 5_000_000);
    expect(out?.moved).toHaveLength(1);
    expect((await repo.getTopic('run'))?.name).toBe('운동용품');
    expect(await undoReorganize(repo, out!.batchId!)).toBe(true);
    expect((await repo.getTopic('run'))?.name).toBe('마라톤');
    expect((await repo.getMemo('hwang'))?.topicId).toBe('run');
  });

  it('apply는 트랜잭션 안에서 새 주제와 링크를 함께 쓴다', async () => {
    const repo = new DexieRepo();
    await repo.addMemo(mkMemo({ id: 'x', status: 'pending' }));
    await repo.addMemo(mkMemo({ id: 'y' }));
    await applyResult(repo, 'x', {
      kind: 'idea', emotion: { label: '담담', color: '#c9c2b0' }, keywords: ['a'], summary: 's',
      topic: { newName: '새', newSummary: '' }, related: [{ id: 'y', strength: 0.5, reason: 'r' }],
    });
    expect((await repo.listTopics()).length).toBeGreaterThanOrEqual(1);
    expect((await repo.getMemo('x'))?.status).toBe('organized');
  });
});
