/** UI가 부르는 저장소 동작. 로직은 core/actions에 있고 여기서는 Dexie 구현을 묶어 준다. */
import * as core from '../core/actions';
import { dexieRepo } from './dexieRepo';

export { TOPIC_PALETTE, pickTopicColor } from '../core/palette';
export type { NewMemoInput } from '../core/actions';

export const addMemo = (input: core.NewMemoInput) => core.addMemo(dexieRepo(), input);
export const deleteMemo = (id: string) => core.deleteMemo(dexieRepo(), id);
export const moveMemoToTopic = (memoId: string, topicId: string) => core.moveMemoToTopic(dexieRepo(), memoId, topicId);
export const moveMemoToNewTopic = (memoId: string, name: string) => core.moveMemoToNewTopic(dexieRepo(), memoId, name);
export const renameTopic = (topicId: string, name: string) => core.renameTopic(dexieRepo(), topicId, name);
export const setDone = (memoId: string, done: boolean) => core.setDone(dexieRepo(), memoId, done);
export const pruneEmptyTopics = () => core.pruneEmptyTopics(dexieRepo());
