import { useEffect, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  compact?: boolean;
}

export function Dropzone({ onFile, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) onFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  const pick = (files: FileList | null | undefined) => {
    const file = [...(files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) onFile(file);
  };

  return (
    <div
      className={`dropzone ${dragging ? "dragging" : ""} ${compact ? "compact" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      {compact ? (
        <span>Change image</span>
      ) : (
        <>
          <div className="dropzone-icon" aria-hidden>
            <svg viewBox="0 0 48 48" width="48" height="48">
              {[0, 1, 2].flatMap((r) =>
                [0, 1, 2].map((c) => (
                  <circle key={`${r}${c}`} cx={10 + c * 14} cy={10 + r * 14} r="6" fill={["#ff6b8b", "#ffc145", "#5cc8ff", "#7ad67a", "#a78bfa"][(r * 3 + c) % 5]} />
                )),
              )}
            </svg>
          </div>
          <strong>Drop an image here</strong>
          <span className="muted">or click to choose a file · you can also paste</span>
        </>
      )}
    </div>
  );
}
