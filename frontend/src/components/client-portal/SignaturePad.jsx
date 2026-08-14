import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 300;

export default function SignaturePad({ disabled = false, onChange, onStrokesChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const strokesRef = useRef([]);
  const activeStrokeRef = useRef(null);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 5;
    context.strokeStyle = "#0f172a";
  }, []);

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
    activeStrokeRef.current = [[point.x / CANVAS_WIDTH, point.y / CANVAS_HEIGHT]];
    context.beginPath();
    context.moveTo(point.x, point.y);
    // A dot makes a tap count as a visible signature stroke.
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
  }

  function draw(event) {
    if (!drawingRef.current || disabled) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const point = pointFor(event);
    activeStrokeRef.current?.push([point.x / CANVAS_WIDTH, point.y / CANVAS_HEIGHT]);
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

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-inner">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          aria-label="Draw your signature"
          className="block h-40 w-full touch-none cursor-crosshair sm:h-44"
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
      <div className="mt-2 flex items-center justify-between gap-3">
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
      </div>
    </div>
  );
}
