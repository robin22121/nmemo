import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { ImportError } from '../../core/exportImport';
import { weeklyStats } from '../../core/stats';
import { importBackup, prepareExport } from '../../db/backup';
import { getDb } from '../../db/schema';

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** share가 안 되면(데스크톱 등) 내려받기 */
function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 지구본 왼쪽 위 "⋯" → 메뉴(Z4): 내보내기(크기 표시, "사진 빼고"), 가져오기(합치기), 최근 7일 정돈 기록(Z5).
 * 내보낼 파일은 메뉴를 열 때 미리 만들어 둔다 → 누르는 즉시 share를 불러 iOS의 사용자 동작 제한에 걸리지 않게.
 */
export function GlobeMenu({ tint, notify }: { tint?: string; notify: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [withPhotos, setWithPhotos] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stats = useLiveQuery(async () => (open ? weeklyStats(await getDb().memos.toArray(), Date.now()) : null), [open], null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFile(null);
    void prepareExport(withPhotos).then(({ name, text }) => {
      if (alive) setFile(new File([text], name, { type: 'application/json' }));
    });
    return () => {
      alive = false;
    };
  }, [open, withPhotos]);

  const onExport = async () => {
    if (!file) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
        setOpen(false);
        notify('내보냈어요');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // 사용자가 공유 창을 닫음
        download(file);
        setOpen(false);
        notify('내보냈어요');
      }
      return;
    }
    download(file);
    setOpen(false);
    notify('내보냈어요');
  };

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await importBackup(await f.text());
      setOpen(false);
      notify(`가져왔어요 · 메모 ${r.memosAdded}개 추가, ${r.memosSkipped}개는 이미 있음 · 주제 ${r.topicsAdded}개 추가, ${r.topicsMerged}개 합침`);
    } catch (e) {
      notify(e instanceof ImportError ? e.message : '가져오지 못했어요');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const statLine = !stats
    ? ''
    : stats.rate === null
      ? '최근 7일 정돈 —'
      : `최근 7일 정돈 ${stats.organized}건 · 직접 옮김 ${stats.moved}건(${Math.round(stats.rate * 100)}%)`;

  return (
    <>
      <button
        type="button"
        className="g-menu-btn"
        data-no-pan
        data-testid="menu-button"
        aria-label="메뉴"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
          <circle cx="5.5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="18.5" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <>
          <div className="g-menu-back" data-no-pan onClick={() => setOpen(false)} />
          <div className="g-menu" data-no-pan data-testid="menu-panel" role="dialog" aria-label="메뉴" style={tint ? { ['--c' as string]: tint } : undefined}>
            <div className="g-menu-row">
              <button type="button" className="g-menu-act" data-testid="menu-export" disabled={!file} onClick={() => void onExport()}>
                내보내기
                <span className="g-menu-size" data-testid="menu-export-size">{file ? `약 ${fmtSize(file.size)}` : '준비 중…'}</span>
              </button>
              <label className="g-menu-check">
                <input type="checkbox" data-testid="menu-no-photos" checked={!withPhotos} onChange={(e) => setWithPhotos(!e.target.checked)} />
                사진 빼고
              </label>
            </div>
            <label className={`g-menu-act${busy ? ' busy' : ''}`} data-testid="menu-import">
              {busy ? '가져오는 중…' : '가져오기'}
              <span className="g-menu-size">같은 메모는 건너뛰고 합쳐요</span>
              <input
                ref={inputRef}
                type="file"
                accept=".json,application/json"
                data-testid="menu-import-input"
                disabled={busy}
                className="g-menu-file"
                onChange={(e) => void onImport(e.target.files?.[0])}
              />
            </label>
            <p className="g-menu-note">내보낸 파일을 메신저로 옮기면 메모 전문이 그 회사 서버를 거쳐요.</p>
            <p className="g-menu-stats" data-testid="menu-stats">{statLine}</p>
          </div>
        </>
      )}
    </>
  );
}
