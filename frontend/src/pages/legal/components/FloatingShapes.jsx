import { motion, useReducedMotion } from "framer-motion";

const SHAPES = [
  { cx: "12%", cy: "20%", r: 90, duration: 14 },
  { cx: "85%", cy: "70%", r: 130, duration: 18 },
  { cx: "60%", cy: "15%", r: 60, duration: 11 },
];

// Slow-drifting translucent circles sitting behind section content — kept
// to a handful per section so text stays readable, disabled entirely under
// reduced-motion since their only job is ambient movement.
export default function FloatingShapes() {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {SHAPES.map((shape, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-white/[0.05]"
          style={{ left: shape.cx, top: shape.cy, width: shape.r * 2, height: shape.r * 2 }}
          animate={{ x: [0, 24, -12, 0], y: [0, -18, 14, 0] }}
          transition={{ duration: shape.duration, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}
