import { motion } from "framer-motion";
import LegalIcon from "./LegalIcons";
import FloatingShapes from "./FloatingShapes";
import TextureDivider from "./TextureDivider";

const revealUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function SectionBlock({ id, title, tagline, accentColor, features = [], quickFacts = [], navSectionId }) {
  const bg = accentColor ? accentColor.bg : "#0A0A0A";

  return (
    <section id={id} className="relative isolate scroll-mt-16 overflow-hidden px-5 py-20 sm:px-8 sm:py-28" style={{ backgroundColor: bg, color: "#F5F5F0" }}>
      <FloatingShapes />
      <div className="relative mx-auto max-w-4xl">
        <motion.div variants={stagger} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }}>
          <motion.h2 variants={revealUp} className="font-heading text-[clamp(2rem,4.5vw,3.75rem)] italic leading-[1.05] tracking-tight">
            {title}
          </motion.h2>
          <motion.p variants={revealUp} className="mt-3 max-w-xl text-lg opacity-80">
            {tagline}
          </motion.p>

          {features.length ? (
            <div className="mt-14 grid gap-10 sm:grid-cols-2">
              {features.map((feature) => (
                <motion.div key={feature.h3} variants={revealUp} className="space-y-3">
                  {feature.icon ? <LegalIcon name={feature.icon} className="h-9 w-9 opacity-90" /> : null}
                  <h3 className="text-xl font-semibold tracking-tight">{feature.h3}</h3>
                  <p className="text-sm font-medium uppercase tracking-[0.14em] opacity-60">{feature.h4}</p>
                  <p className="max-w-[65ch] text-[15px] leading-7 opacity-90">{feature.body}</p>
                </motion.div>
              ))}
            </div>
          ) : null}

          {quickFacts.length ? (
            <motion.div variants={revealUp} className="mt-14 grid gap-x-8 gap-y-4 border-t border-white/15 pt-8 sm:grid-cols-2">
              {quickFacts.map((fact) => (
                <div key={fact.title} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" />
                  <p className="text-sm leading-6 opacity-85">
                    <span className="font-semibold opacity-100">{fact.title}. </span>
                    {fact.text}
                  </p>
                </div>
              ))}
            </motion.div>
          ) : null}
        </motion.div>
      </div>

      <div className="relative mt-16">
        <TextureDivider />
        <a href={`#${navSectionId}`} className="mt-4 inline-block text-xs font-medium uppercase tracking-[0.14em] opacity-60 transition hover:opacity-100">
          ↑ Back to navigation
        </a>
      </div>
    </section>
  );
}
