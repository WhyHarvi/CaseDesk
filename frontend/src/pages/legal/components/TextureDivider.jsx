let filterId = 0;

export default function TextureDivider() {
  const id = `legal-grain-${(filterId += 1)}`;
  return (
    <div className="relative h-10 w-full overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full opacity-[0.06]" preserveAspectRatio="none">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </svg>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
    </div>
  );
}
