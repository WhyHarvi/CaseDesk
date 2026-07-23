import StickyNav from "./components/StickyNav";
import LegalHero from "./components/LegalHero";
import SectionBlock from "./components/SectionBlock";
import LegalContactCta from "./components/LegalContactCta";
import { colorForIndex } from "./legalTheme";

export default function LegalPageShell({ headline, lastUpdated, summary, sections, otherPage, contact }) {
  const navSections = sections.map((section) => ({ id: section.id, label: section.navLabel || section.title }));

  return (
    <div id="legal-top" className="font-body" style={{ backgroundColor: "#0A0A0A" }}>
      <StickyNav sections={navSections} otherPage={otherPage} />
      <LegalHero headline={headline} lastUpdated={lastUpdated} summary={summary} />
      {sections.map((section, index) => (
        <SectionBlock
          key={section.id}
          id={section.id}
          title={section.title}
          tagline={section.tagline}
          features={section.features}
          quickFacts={section.quickFacts}
          accentColor={index % 2 === 1 ? colorForIndex(Math.floor(index / 2)) : null}
          navSectionId="legal-top"
        />
      ))}
      <LegalContactCta heading={contact.heading} body={contact.body} email={contact.email} ctaLabel={contact.ctaLabel} />
    </div>
  );
}
