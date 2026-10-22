import { useRef, useState } from 'react';
import { addMemo } from '../../db/repo';
import { getQueue } from '../../organize/runtime';

/**
 * 바로 쓰기 목업(`?globe=1&write=1`): 정면에 큰 쓰기 칸, 뒤에는 반투명 덮개 너머로 지구본이 천천히 돈다.
 * Enter → 기존 저장 경로(addMemo + 대기열 깨우기) 후 쓰기 칸은 사라진다(D6). 덮개를 탭하면 닫힌다.
 */
export function GlobeComposer({ onDismiss }: { onDismiss: () => void }) {
  const [text, setText] = useState('');
  const down = useRef<{ x: number; y: number } | null>(null);

  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    await addMemo({ input: 'text', text: v });
    getQueue().wake();
    onDismiss();
  };

  return (
    <>
      <div
        className="g-dim"
        data-no-pan
        data-testid="composer-dim"
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = down.current;
          down.current = null;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) onDismiss();
        }}
      />
      <div className="g-composer" data-no-pan>
        <textarea
          autoFocus
          value={text}
          placeholder="떠오르는 걸 바로 적어요"
          aria-label="메모 쓰기"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') onDismiss();
          }}
        />
        <div className="g-composer-bar">
          <span>Enter 저장 · Shift+Enter 줄바꿈</span>
          <button type="button" className="g-plus" aria-label="녹음·사진" title="녹음·사진(목업)">+</button>
        </div>
      </div>
    </>
  );
}
