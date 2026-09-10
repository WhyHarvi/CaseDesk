import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";

// Replays normalized [0,1] stroke points into whatever pixel size the canvas
// currently has. Strokes are stored as fractions of the canvas's own
// width/height (not fixed pixel coordinates), so this works whether the
// canvas just resized (window resize, orientation change) or swapped to the
// full-screen canvas below — same signature, redrawn to fit.
function redraw(canvas, context, strokes) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    const [firstX, firstY] = stroke[0];
    context.beginPath();
    context.moveTo(firstX * canvas.width, firstY * canvas.height);
    if (stroke.length === 1) {
      // A tap-only stroke needs a visible dot, not an invisible zero-length path.
      context.lineTo(firstX * canvas.width + 0.01, firstY * canvas.height + 0.01);
    }
    for (const [x, y] of stroke) context.lineTo(x * canvas.width, y * canvas.height);
    context.stroke();
  }
}

// Matching the canvas's internal pixel buffer to its actual displayed size
// (rather than a fixed resolution) is the whole fix here — previously a
// hardcoded 900x300 buffer was stretched non-uniformly by CSS onto whatever
// box it was actually rendered at (a different shape on nearly every
// screen), so every signature came out squeezed or stretched depending on
// how far the display box's proportions drifted from 900:300. Once the
// buffer always matches the box 1:1 (times devicePixelRatio for crispness),
// there's nothing left to stretch.
function resizeCanvas(canvas, strokes) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2.75 * dpr;
  context.strokeStyle = "#0f172a";
  redraw(canvas, context, strokes);
}

export default function SignaturePad({ disabled = false, onChange, onStrokesChange }) {
  const canvasRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const drawingRef = useRef(false);
  const strokesRef = useRef([]);
  const activeStrokeRef = useRef(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const attachCanvas = useCallback((node) => {
    canvasRef.current = node;
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (!node) return;
    resizeCanvas(node, strokesRef.current);
    const observer = new ResizeObserver(() => resizeCanvas(node, strokesRef.current));
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  function pointFor(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDrawing(event) {
    if (disabled) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = pointFor(event);
    canvas.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    activeStrokeRef.current = [[point.x / canvas.width, point.y / canvas.height]];
    context.beginPath();
    context.moveTo(point.x, point.y);
    // A dot makes a tap count as a visible signature stroke.
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
  }

  function draw(event) {
    if (!drawingRef.current || disabled) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = pointFor(event);
    activeStrokeRef.current?.push([point.x / canvas.width, point.y / canvas.height]);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function finishDrawing(event) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    canvasRef.current.releasePointerCapture?.(event.pointerId);
    if (activeStrokeRef.current?.length) strokesRef.current.push(activeStrokeRef.current);
    activeStrokeRef.current = null;
    setHasSignature(true);
    onChange?.(canvasRef.current.toDataURL("image/png"));
    onStrokesChange?.(strokesRef.current.map((stroke) => stroke.map((point) => [...point])));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current = [];
    activeStrokeRef.current = null;
    setHasSignature(false);
    onChange?.("");
    onStrokesChange?.([]);
  }

  function canvasBox(className) {
    return (
      <div className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-inner ${className}`}>
        <canvas
          ref={attachCanvas}
          aria-label="Draw your signature"
          className="block h-full w-full touch-none cursor-crosshair"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={finishDrawing}
          onPointerCancel={finishDrawing}
        />
        <div className="pointer-events-none absolute inset-x-5 bottom-7 border-b border-dashed border-slate-300" />
        {!hasSignature ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-5 text-center text-sm text-slate-400">
            Draw with your finger, stylus, or mouse
          </p>
        ) : null}
      </div>
    );
  }

  if (fullscreen && typeof document !== "undefined") {
    return createPortal(
      <div className="fixed inset-0 z-[10050] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Sign your name, full screen">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">Draw your signature</p>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-95"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            Done
          </button>
        </header>
        <div className="min-h-0 flex-1 p-5">{canvasBox("h-full")}</div>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <p className="text-[11px] leading-4 text-slate-400">Keep your signature inside the box.</p>
          <button
            type="button"
            disabled={disabled || !hasSignature}
            onClick={clear}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        </footer>
      </div>,
      document.body,
    );
  }

  return (
    <div>
      {canvasBox("h-40 sm:h-44")}
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-slate-400">Keep your signature inside the box.</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setFullscreen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Full screen
          </button>
          <button
            type="button"
            disabled={disabled || !hasSignature}
            onClick={clear}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
