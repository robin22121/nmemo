import { newId } from './ids';
import { pickTopicColor } from './palette';
import type { Repo } from './repo';
import type { InputType, Memo, Topic } from './types';

export interface NewMemoInput {
  /** 입력 바 미리보기와 같은 id를 쓰면 날아가는 애니메이션이 이어진다 */
  id?: string;
  input: InputType;
  text: string;
  photo?: Blob;
}

export function makeTopic(name: string, summary: string, existing: Pick<Topic, 'color'>[], now: number, centerKeywords: string[] = []): Topic {
  return {
    id: newId(),
    name,
    summary,
    color: pickTopicColor(existing),
    createdAt: now,
    centerKeywords,
    nameLocked: false,
    lastReorgAt: now,
    sinceReorg: 0,
  };
}

/** 입력 즉시 pending으로 저장한다. 결정할 것은 없다. */
export async function addMemo(repo: Repo, input: NewMemoInput, now = Date.now()): Promise<Memo> {
  const memo: Memo = {
    id: input.id ?? newId(),
    createdAt: now,
    input: input.input,
    text: input.text.trim(),
    photo: input.photo,
    topicLocked: false,
    status: 'pending',
    attempts: 0,
  };
  await repo.addMemo(memo);
  return memo;
}

/** 메모가 하나도 없는 주제를 지운다. */
export async function pruneEmptyTopics(repo: Repo): Promise<number> {
  let removed = 0;
  for (const t of await repo.listTopics()) {
    if ((await repo.countMemosByTopic(t.id)) === 0) {
      await repo.deleteTopic(t.id);
      removed++;
    }
  }
  return removed;
}

export async function deleteMemo(repo: Repo, id: string): Promise<void> {
  await repo.transaction(async (r) => {
    await r.deleteMemo(id);
    await r.deleteLinksOf(id);
    await pruneEmptyTopics(r);
  });
}

export async function moveMemoToTopic(repo: Repo, memoId: string, topicId: string): Promise<void> {
  await repo.transaction(async (r) => {
    await r.updateMemo(memoId, { topicId, topicLocked: true });
    await pruneEmptyTopics(r);
  });
}

export async function moveMemoToNewTopic(repo: Repo, memoId: string, name: string, now = Date.now()): Promise<Topic> {
  return repo.transaction(async (r) => {
    const t = makeTopic(name.trim() || '새 주제', '', await r.listTopics(), now);
    await r.addTopic(t);
    await r.updateMemo(memoId, { topicId: t.id, topicLocked: true });
    await pruneEmptyTopics(r);
    return t;
  });
}

/**
 * 사용자가 주제 이름을 고친다 → nameLocked, 그리고 재구성이 바로 돌도록 표시한다
 * (10분 규칙의 예외: lastReorgAt=0, sinceReorg를 임계값 이상으로).
 */
export async function renameTopic(repo: Repo, topicId: string, name: string): Promise<void> {
  const n = name.trim();
  if (!n) return;
  await repo.updateTopic(topicId, { name: n, nameLocked: true, lastReorgAt: 0, sinceReorg: 99 });
}

export async function setDone(repo: Repo, memoId: string, done: boolean): Promise<void> {
  await repo.updateMemo(memoId, { done });
}
