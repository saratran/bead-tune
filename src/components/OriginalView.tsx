import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cropPixels, isFullCrop } from "../lib/crop";
import type { Crop } from "../lib/sampling";
import { canvasScale } from "./PatternView";

interface Props {
  image: HTMLImageElement;
  crop: Crop;
  onHide: () => void;
}

type Scope = "crop" | "whole";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const PAN_THRESHOLD = 4;

/** The source image as a zoomable, pannable reference next to the pattern. */
export function OriginalView({ image, crop, onHide }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrap, setWrap] = useState({ w: 400, h: 300 });
  const [zoom, setZoom] = useState(1);
  const [scope, setScope] = useState<Scope>("crop");
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const centre = useRef({ x: 0.5, y: 0.5 });

  const imgW = image.naturalWidth || image.width;
  const imgH = image.naturalHeight || image.height;
  const cropped = !isFullCrop(crop);
  const region = scope === "crop" ? cropPixels(crop, imgW, imgH) : { x: 0, y: 0, w: imgW, h: imgH };
  const fit = Math.min(wrap.w / region.w, wrap.h / region.h);
  const scale = fit * zoom;
  const cssW = Math.max(1, Math.round(region.w * scale));
  const cssH = Math.max(1, Math.round(region.h * scale));
  const zoomBy = (f: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * f)));

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (el.clientWidth > 0) setWrap({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([entry]) => entry && setWrap({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = canvasScale(cssW, cssH, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * s);
    canvas.height = Math.round(cssH * s);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, region.x, region.y, region.w, region.h, 0, 0, cssW, cssH);
    if (scope === "whole" && cropped) {
      // Dim everything outside the crop and outline it.
      const c = cropPixels(crop, imgW, imgH);
      const k = cssW / imgW;
      const [x, y, w, h] = [c.x * k, c.y * k, c.w * k, c.h * k];
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, cssW, y);
      ctx.fillRect(0, y + h, cssW, cssH - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, cssW - x - w, h);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }, [image, crop, scope, cssW, cssH, cropped, imgW, imgH, region.x, region.y, region.w, region.h]);

  // Keep the middle of the view in place when zooming.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.scrollLeft = centre.current.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = centre.current.y * el.scrollHeight - el.clientHeight / 2;
  }, [cssW, cssH]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * Math.exp(-e.deltaY * 0.002))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <section className="original-view" aria-label="Original image">
      <div className="original-bar">
        <strong>Original</strong>
        {cropped && (
          <div className="segmented" role="radiogroup" aria-label="Original area">
            {(
              [
                ["crop", "Crop"],
                ["whole", "Whole"],
              ] as const
            ).map(([s, label]) => (
              <button key={s} role="radio" aria-checked={scope === s} className={scope === s ? "on" : ""} onClick={() => setScope(s)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="zoom" role="group" aria-label="Original zoom">
          <button className="btn btn-ghost" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom original out">
            −
          </button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom original in">
            +
          </button>
          <button className="btn btn-ghost" onClick={() => setZoom(1)} disabled={zoom === 1}>
            Fit
          </button>
        </div>
        <button className="icon-btn" onClick={onHide} aria-label="Hide original" title="Hide original">
          ×
        </button>
      </div>
      <div
        className="original-scroll"
        ref={wrapRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollWidth > 0 && el.scrollHeight > 0) {
            centre.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
          }
        }}
      >
        <canvas
          ref={canvasRef}
          className="original-canvas"
          onPointerDown={(e) => {
            if (!wrapRef.current) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            pan.current = { x: e.clientX, y: e.clientY, left: wrapRef.current.scrollLeft, top: wrapRef.current.scrollTop };
          }}
          onPointerMove={(e) => {
            const p = pan.current;
            const el = wrapRef.current;
            if (!p || !el) return;
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < PAN_THRESHOLD) return;
            el.scrollLeft = p.left - (e.clientX - p.x);
            el.scrollTop = p.top - (e.clientY - p.y);
          }}
          onPointerUp={() => (pan.current = null)}
          onPointerCancel={() => (pan.current = null)}
        />
      </div>
    </section>
  );
}
