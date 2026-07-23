// Shared design tokens for the animated legal pages (Privacy Policy, Terms
// of Service). One saturated accent per section, rotating in a fixed order
// so both pages read as the same system.
export const SECTION_COLORS = [
  { name: "cobalt", bg: "#1D4ED8", soft: "rgba(29,78,216,0.16)" },
  { name: "emerald", bg: "#047857", soft: "rgba(4,120,87,0.16)" },
  { name: "mustard", bg: "#B45309", soft: "rgba(180,83,9,0.16)" },
  { name: "crimson", bg: "#B91C1C", soft: "rgba(185,28,28,0.16)" },
];

export function colorForIndex(index) {
  return SECTION_COLORS[index % SECTION_COLORS.length];
}

export const CANVAS_BG = "#0A0A0A";
export const CANVAS_TEXT = "#F5F5F0";
