import { getDb, linkId, type InputType, type Memo, type Topic } from './schema';

/** 무리 색 팔레트(옅은 배경 번짐에 어울리는 중간 채도) */
export const TOPIC_PALETTE = [
  '#e8a87c', '#85cdca', '#c38d9e', '#7fb069', '#8ea9e8', '#e6c35c', '#b58de8', '#e88e8e',
];

export function pickTopicColor(topics: Pick<Topic, 'color'>[]): string {
  const used = new Set(topics.map((t) => t.color));
  const free = TOPIC_PALETTE.find((c) => !used.has(c));
  return free ?? TOPIC_PALETTE[topics.length % TOPIC_PALETTE.length]!;
}

export interface NewMemoInput {
  input: InputType;
  text: string;
  photo?: Blob;
}

/** 입력 즉시 pending으로 저장한다. 결정할 것은 없다. */
export async function addMemo(input: NewMemoInput): Promise<Memo> {
  const memo: Memo = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    input: input.input,
    text: input.text.trim(),
    photo: input.photo,
    topicLocked: false,
    status: 'pending',
    attempts: 0,
  };
  await getDb().memos.add(memo);
  return memo;
}

/** 메모가 하나도 없는 주제를 지운다. */
export async function pruneEmptyTopics(): Promise<number> {
  const db = getDb();
  const topics = await db.topics.toArray();
  let removed = 0;
  for (const t of topics) {
    const n = await db.memos.where('topicId').equals(t.id).count();
    if (n === 0) {
      await db.topics.delete(t.id);
      removed++;
    }
  }
  return removed;
}

export async function deleteMemo(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.memos, db.topics, db.links, async () => {
    await db.memos.delete(id);
    await db.links.where('fromId').equals(id).delete();
    await db.links.where('toId').equals(id).delete();
    await pruneEmptyTopics();
  });
}

export async function moveMemoToTopic(memoId: string, topicId: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.memos, db.topics, async () => {
    await db.memos.update(memoId, { topicId, topicLocked: true });
    await pruneEmptyTopics();
  });
}

export async function moveMemoToNewTopic(memoId: string, name: string): Promise<Topic> {
  const db = getDb();
  const topic = await db.transaction('rw', db.memos, db.topics, async () => {
    const topics = await db.topics.toArray();
    const t: Topic = {
      id: crypto.randomUUID(),
      name: name.trim() || '새 주제',
      summary: '',
      color: pickTopicColor(topics),
      createdAt: Date.now(),
    };
    await db.topics.add(t);
    await db.memos.update(memoId, { topicId: t.id, topicLocked: true });
    await pruneEmptyTopics();
    return t;
  });
  return topic;
}

export async function renameTopic(topicId: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  await getDb().topics.update(topicId, { name: n });
}

export async function setDone(memoId: string, done: boolean): Promise<void> {
  await getDb().memos.update(memoId, { done });
}

export { linkId };
