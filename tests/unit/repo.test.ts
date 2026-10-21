import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb } from '../../src/db/schema';
import { addMemo, deleteMemo, moveMemoToNewTopic, moveMemoToTopic, pickTopicColor, TOPIC_PALETTE } from '../../src/db/repo';

let n = 0;
beforeEach(() => {
  initDb(`test-repo-${n++}`);
});

describe('repo', () => {
  it('새 메모는 pending으로 저장된다', async () => {
    const m = await addMemo({ input: 'text', text: '  동네 카페 가보기  ' });
    const saved = await getDb().memos.get(m.id);
    expect(saved?.status).toBe('pending');
    expect(saved?.text).toBe('동네 카페 가보기');
    expect(saved?.topicLocked).toBe(false);
    expect(saved?.attempts).toBe(0);
  });

  it('미리 정한 id를 그대로 쓰고 사진 메모는 비어 있는 글로 저장된다', async () => {
    const m = await addMemo({ id: 'fixed-id', input: 'photo', text: '', photo: new Blob(['x'], { type: 'image/jpeg' }) });
    expect(m.id).toBe('fixed-id');
    const saved = await getDb().memos.get('fixed-id');
    expect(saved?.input).toBe('photo');
    expect(saved?.status).toBe('pending');
  });

  it('주제를 옮기면 잠기고, 비게 된 주제는 지워진다', async () => {
    const a = await addMemo({ input: 'text', text: 'a' });
    const t1 = await moveMemoToNewTopic(a.id, '첫 주제');
    const b = await addMemo({ input: 'text', text: 'b' });
    const t2 = await moveMemoToNewTopic(b.id, '둘째 주제');
    await moveMemoToTopic(a.id, t2.id);
    expect(await getDb().topics.get(t1.id)).toBeUndefined();
    const moved = await getDb().memos.get(a.id);
    expect(moved?.topicId).toBe(t2.id);
    expect(moved?.topicLocked).toBe(true);
  });

  it('메모를 지우면 링크와 빈 주제도 정리된다', async () => {
    const a = await addMemo({ input: 'text', text: 'a' });
    const t = await moveMemoToNewTopic(a.id, '주제');
    await getDb().links.add({ id: 'x|y', fromId: a.id, toId: 'y', strength: 0.5, reason: 'r' });
    await deleteMemo(a.id);
    expect(await getDb().links.count()).toBe(0);
    expect(await getDb().topics.get(t.id)).toBeUndefined();
  });

  it('주제 색은 쓰이지 않은 것부터 배정된다', () => {
    expect(pickTopicColor([{ color: TOPIC_PALETTE[0]! }])).toBe(TOPIC_PALETTE[1]);
  });
});
