import loader from "../../assets/loader.png";

// Spins the actual CaseDesk knot mark in place of a generic spinner.
// `prefers-reduced-motion` is handled globally in index.css (it freezes
// all animations), so no extra handling is needed here.
export default function LogoLoader({ size = 56, className = "" }) {
  const dimension = `${size}px`;
  return (
    <img
      src={loader}
      alt="Loading"
      role="status"
      className={`casedesk-logo-loader ${className}`}
      style={{ width: dimension, height: dimension }}
    />
  );
}
