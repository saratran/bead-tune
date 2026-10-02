import { useEffect, useRef, useState } from "react";
import { buildExportFile, composeExport, type ExportFormat, type ExportSettings, type ExportSize } from "../lib/export";
import type { Pattern } from "../lib/pattern";
import { downloadBlob } from "../lib/render";
import { ShapePicker } from "./ShapePicker";
import { Toggle } from "./Toggle";

interface Props {
  pattern: Pattern;
  boardSize: number;
  baseName: string;
  settings: ExportSettings;
  onChange: (s: ExportSettings) => void;
  onClose: () => void;
}

const PREVIEW_MAX_CELL = 16;

function Segmented<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o} className={value === o ? "on" : ""} onClick={() => onChange(o)}>
          {o.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function ExportDialog({ pattern, boardSize, baseName, settings: s, onChange, onClose }: Props) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => onChange({ ...s, [key]: value });
  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
  const multiBoard = pattern.width > boardSize || pattern.height > boardSize;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // Wait a frame so toggling stays responsive on large patterns.
    const id = requestAnimationFrame(() => {
      const canvas = composeExport(pattern, s, { maxCell: PREVIEW_MAX_CELL });
      canvas.className = "export-preview-canvas";
      previewRef.current?.replaceChildren(canvas);
    });
    return () => cancelAnimationFrame(id);
  }, [pattern, s]);

  const run = async (share: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const file = await buildExportFile(pattern, s, boardSize, baseName);
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name });
      } else {
        downloadBlob(file, file.name);
      }
    } catch (e) {
      // Closing the share sheet isn't an error worth showing.
      if ((e as Error).name !== "AbortError") setError((e as Error).message || "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal export-modal" role="dialog" aria-modal="true" aria-label="Export" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Export</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="export-body">
          <div className="export-preview" ref={previewRef} />

          <div className="export-settings">
            <div className="setting-group">
              <div className="setting-row">
                <span>Export format</span>
                <Segmented<ExportFormat> options={["png", "pdf"]} value={s.format} onChange={(v) => set("format", v)} />
              </div>
              <div className="setting-row">
                <span>Size</span>
                <Segmented<ExportSize> options={["L", "M", "S"]} value={s.size} onChange={(v) => set("size", v)} />
              </div>
              {s.format === "pdf" && multiBoard && (
                <div className="setting-row">
                  <Toggle label="One page per pegboard" checked={s.splitBoards} onChange={(v) => set("splitBoards", v)} />
                </div>
              )}
            </div>

            <div className="setting-group">
              <div className="setting-row">
                <span>Cell shape</span>
                <ShapePicker value={s.shape} onChange={(v) => set("shape", v)} />
              </div>
              <div className="setting-row">
                <Toggle label="Colour codes" checked={s.codes} onChange={(v) => set("codes", v)} />
              </div>
              <div className="setting-row">
                <Toggle label="Grid" checked={s.grid} onChange={(v) => set("grid", v)} />
              </div>
              <div className="setting-row">
                <Toggle label="Analysis diagram" checked={s.analysis} onChange={(v) => set("analysis", v)} />
                <span className="hint">Coordinates + lines every 5 / 10</span>
              </div>
              <div className="setting-row">
                <Toggle label="Count summary" checked={s.counts} onChange={(v) => set("counts", v)} />
              </div>
            </div>

            <div className="setting-group">
              <div className="setting-row">
                <Toggle label="Title" checked={s.title} onChange={(v) => set("title", v)} />
              </div>
              {s.title && (
                <input
                  className="input"
                  placeholder="Pattern name"
                  value={s.titleText}
                  onChange={(e) => set("titleText", e.target.value)}
                />
              )}
              <div className="setting-row">
                <Toggle label="Watermark" checked={s.watermark} onChange={(v) => set("watermark", v)} />
              </div>
              {s.watermark && (
                <input
                  className="input"
                  placeholder="Watermark text, e.g. your name"
                  value={s.watermarkText}
                  onChange={(e) => set("watermarkText", e.target.value)}
                />
              )}
              <div className="setting-row">
                <Toggle label="Shadow" checked={s.shadow} onChange={(v) => set("shadow", v)} />
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          {error ? <span className="error">{error}</span> : <span />}
          <div className="actions">
            {canShare && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => run(true)}>
                Share
              </button>
            )}
            <button className="btn btn-primary" disabled={busy} onClick={() => run(false)}>
              {busy ? "Exporting…" : `Download ${s.format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
