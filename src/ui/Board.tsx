import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/schema';

export function Board() {
  const count = useLiveQuery(() => getDb().memos.count(), [], 0);
  return (
    <div className="board" data-testid="board">
      {count === 0 && <div className="empty-hint">떠오르는 걸 아무렇게나 던져보세요</div>}
    </div>
  );
}
