import { motion, useReducedMotion } from "framer-motion";

const word = {
  hidden: { y: "100%", opacity: 0 },
  visible: (i) => ({ y: "0%", opacity: 1, transition: { duration: 0.7, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] } }),
};

export default function AnimatedHeadline({ text, as: Tag = "h1", className = "" }) {
  const reduceMotion = useReducedMotion();
  const words = text.split(" ");

  if (reduceMotion) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.1em] align-bottom">
          <motion.span className="inline-block" custom={i} variants={word} initial="hidden" animate="visible">
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}
