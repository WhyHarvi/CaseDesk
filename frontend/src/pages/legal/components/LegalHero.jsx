import { motion } from "framer-motion";
import AnimatedHeadline from "./AnimatedHeadline";
import FloatingShapes from "./FloatingShapes";

export default function LegalHero({ headline, lastUpdated, summary }) {
  return (
    <section className="relative isolate overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pt-24" style={{ backgroundColor: "#0A0A0A", color: "#F5F5F0" }}>
      <FloatingShapes />
      <div className="relative mx-auto max-w-4xl">
        <AnimatedHeadline
          text={headline}
          className="font-heading text-[clamp(3rem,9vw,7rem)] italic leading-[0.98] tracking-tight"
        />
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="mt-6 max-w-xl text-lg leading-7 opacity-80"
        >
          {summary}
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.5 }}
          className="mt-4 text-xs font-medium uppercase tracking-[0.16em] opacity-50"
        >
          Last updated {lastUpdated}
        </motion.p>
      </div>
    </section>
  );
}
