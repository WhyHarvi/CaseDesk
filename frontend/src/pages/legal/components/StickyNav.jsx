import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

export default function StickyNav({ sections, otherPage }) {
  const [activeId, setActiveId] = useState(sections[0]?.id);
  const [scrolled, setScrolled] = useState(false);
  const scrollerRef = useRef(null);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  // A plain mouse wheel only fires vertical deltaY; without this the pill
  // row (wider than the viewport on most screens) has no way to pan for
  // anyone without a trackpad — same fix as the case-profile workflow strip.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    function handleWheel(event) {
      if (event.deltaY === 0 || event.deltaX !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      className={`sticky top-0 z-40 transition-colors duration-300 ${scrolled ? "bg-[#0A0A0A]/85 backdrop-blur-xl" : "bg-transparent"}`}
      style={{ color: "#F5F5F0" }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5">
        <Link to="/login" className="flex shrink-0 items-center gap-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40">
          <img src="/favicon_logo.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="hidden text-sm font-semibold sm:inline">CaseDesk</span>
        </Link>

        <nav aria-label="Sections" ref={scrollerRef} className="scrollbar-hidden flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
                activeId === section.id ? "bg-white text-[#0A0A0A]" : "text-white/60 hover:text-white"
              }`}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <Link to={otherPage.to} className="shrink-0 whitespace-nowrap rounded-full border border-white/20 px-3.5 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/40 hover:text-white">
          {otherPage.label}
        </Link>
      </div>
    </div>
  );
}
