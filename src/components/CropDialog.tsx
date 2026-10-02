import { useEffect, useRef, useState } from "react";
import { centredCrop, clampCrop, cropPixels, dragCrop, FULL_CROP, isFullCrop, type CropHandle } from "../lib/crop";
import type { Crop } from "../lib/sampling";

interface Props {
  image: HTMLImageElement;
  crop: Crop;
  onApply: (crop: Crop) => void;
  onClose: () => void;
}

const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Shape = "free" | "square";

export function CropDialog({ image, crop: initial, onApply, onClose }: Props) {
  const [crop, setCrop] = useState<Crop>(initial);
  const [shape, setShape] = useState<Shape>("free");
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: Crop } | null>(null);
  const imgW = image.naturalWidth || image.width;
  const imgH = image.naturalHeight || image.height;
  const imageAspect = imgW / imgH;
  const aspect = shape === "square" ? 1 : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startDrag = (handle: CropHandle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const rect = frameRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width === 0 || rect.height === 0) return;
    const dx = (e.clientX - d.x) / rect.width;
    const dy = (e.clientY - d.y) / rect.height;
    setCrop(dragCrop(d.start, d.handle, dx, dy, aspect, imageAspect));
  };

  const chooseShape = (s: Shape) => {
    setShape(s);
    if (s === "square") {
      // Fit a square inside the current crop, keeping its centre.
      const px = cropPixels(crop, imgW, imgH);
      const side = Math.min(px.w, px.h);
      setCrop(
        clampCrop({
          x: (px.x + (px.w - side) / 2) / imgW,
          y: (px.y + (px.h - side) / 2) / imgH,
          w: side / imgW,
          h: side / imgH,
        }),
      );
    }
  };

  const px = cropPixels(crop, imgW, imgH);
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal crop-modal" role="dialog" aria-modal="true" aria-label="Crop image" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Crop image</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="crop-tools">
          <div className="segmented" role="radiogroup" aria-label="Crop shape">
            {(
              [
                ["free", "Free"],
                ["square", "Square"],
              ] as const
            ).map(([s, label]) => (
              <button key={s} role="radio" aria-checked={shape === s} className={shape === s ? "on" : ""} onClick={() => chooseShape(s)}>
                {label}
              </button>
            ))}
          </div>
          <span className="muted small crop-size">
            {px.w} × {px.h} px
          </span>
          <button
            className="btn btn-ghost"
            disabled={isFullCrop(crop)}
            onClick={() => setCrop(shape === "square" ? centredCrop(1, imageAspect) : FULL_CROP)}
          >
            Reset
          </button>
        </div>

        <div className="crop-stage">
          <div className="crop-frame" ref={frameRef} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
            <img src={image.src} alt="Original" draggable={false} />
            <div
              className="crop-box"
              data-testid="crop-box"
              style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
              onPointerDown={startDrag("move")}
            >
              {HANDLES.map((h) => (
                <span key={h} className={`crop-handle h-${h}`} data-handle={h} aria-hidden onPointerDown={startDrag(h)} />
              ))}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="muted small">Drag the frame to move it, or its edges and corners to resize.</span>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => onApply(isFullCrop(crop) ? FULL_CROP : crop)}>
              Apply crop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
