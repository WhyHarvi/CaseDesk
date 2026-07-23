import { motion, useReducedMotion } from "framer-motion";

// Hand-authored line icons, animated by drawing their stroke in on scroll
// (strokeDasharray/strokeDashoffset via framer-motion path variants). Kept
// to a single stroke weight/viewBox so they drop into SectionBlock feature
// slots interchangeably.
const PATHS = {
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M5 11h14v10H5z"],
  shield: ["M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  fingerprint: [
    "M12 3a8 8 0 0 1 8 8c0 3-1 5-1 7",
    "M12 3a8 8 0 0 0-8 8c0 4 1.5 6.5 3 8",
    "M12 7a4 4 0 0 1 4 4c0 4-2 6-2 8",
    "M12 7a4 4 0 0 0-4 4c0 3 1 5 1.5 6.5",
  ],
  check: ["M4 12.5l5 5L20 6"],
  document: ["M6 2h9l5 5v15H6z", "M15 2v5h5", "M9 13h6", "M9 17h6"],
  pen: ["M4 20l1-4L16 5l3 3L8 19l-4 1z", "M14 7l3 3"],
  gavel: ["M9 13l-6 6", "M13 3l8 8", "M7 9l8 8", "M3 21h8"],
  handshake: ["M2 12l5-5 3 2 4-4 8 8-3 3-2-2-3 3-2-2-3 3z"],
  scale: ["M12 3v18", "M5 21h14", "M4 7l4 8H0z", "M20 7l4 8h-8z", "M12 3l-7 4M12 3l7 4"],
};

const draw = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i) => ({
    pathLength: 1,
    opacity: 1,
    transition: { pathLength: { duration: 1.1, delay: i * 0.15, ease: "easeInOut" }, opacity: { duration: 0.3, delay: i * 0.15 } },
  }),
};

export default function LegalIcon({ name, className = "h-10 w-10" }) {
  const reduceMotion = useReducedMotion();
  const paths = PATHS[name] || PATHS.check;

  return (
    <motion.svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      initial={reduceMotion ? "visible" : "hidden"}
      whileInView="visible"
      viewport={{ once: true, amount: 0.6 }}
    >
      {paths.map((d, i) => (
        <motion.path key={d} d={d} custom={i} variants={reduceMotion ? undefined : draw} />
      ))}
    </motion.svg>
  );
}
