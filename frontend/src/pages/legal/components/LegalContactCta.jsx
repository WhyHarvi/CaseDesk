import { motion } from "framer-motion";
import { Link } from "react-router-dom";

export default function LegalContactCta({ heading, body, email, ctaLabel }) {
  return (
    <section className="relative overflow-hidden px-5 py-24 sm:px-8" style={{ backgroundColor: "#0A0A0A", color: "#F5F5F0" }}>
      <div className="mx-auto max-w-3xl text-center">
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
          className="font-heading text-[clamp(2rem,5vw,4rem)] italic leading-[1.05] tracking-tight"
        >
          {heading}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mx-auto mt-4 max-w-lg text-[15px] leading-7 opacity-80"
        >
          {body}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <a href={`mailto:${email}`} className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#0A0A0A] transition hover:bg-white/90">
            {ctaLabel}
          </a>
          <Link to="/login" className="rounded-full border border-white/25 px-6 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white">
            Back to sign in
          </Link>
        </motion.div>
        <p className="mt-10 text-xs uppercase tracking-[0.16em] opacity-40">CHK Immigration Services Inc. — Ontario, Canada</p>
      </div>
    </section>
  );
}
