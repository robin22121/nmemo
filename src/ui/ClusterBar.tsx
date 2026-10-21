import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { spring } from '../motion/presets';

interface Props {
  topic: { id: string; name: string; summary: string; nameLocked: boolean } | null;
  count: number;
  onBack: () => void;
  onRename: (name: string) => void;
}

/** 무리 상세 상단 바: 뒤로 가기 + 주제 이름(눌러서 고치기) */
export function ClusterBar({ topic, count, onBack, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => setEditing(false), [topic?.id]);

  const commit = () => {
    setEditing(false);
    if (topic && name.trim() && name.trim() !== topic.name) onRename(name.trim());
  };

  return (
    <AnimatePresence>
      {topic && (
        <motion.header
          key="cbar"
          className="cluster-bar"
          data-testid="cluster-bar"
          initial={{ y: -70, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -70, opacity: 0 }}
          transition={spring.snappy}
        >
          <button type="button" className="cbar-back" onClick={onBack} aria-label="뒤로" data-testid="cluster-back">
            ‹
          </button>
          {editing ? (
            <input
              ref={input}
              className="cbar-input"
              value={name}
              maxLength={24}
              aria-label="주제 이름 고치기"
              data-testid="cluster-name-input"
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="cbar-title"
              data-testid="cluster-title"
              onClick={() => {
                setName(topic.name);
                setEditing(true);
              }}
            >
              {topic.name}
              <small>{topic.nameLocked ? '내가 정한 이름 · ' : ''}메모 {count}개 · 눌러서 이름 고치기</small>
            </button>
          )}
        </motion.header>
      )}
    </AnimatePresence>
  );
}
