import LegalPageShell from "./LegalPageShell";

const SECTIONS = [
  {
    id: "overview",
    navLabel: "Overview",
    title: "The agreement, upfront.",
    tagline: "These Terms govern access to and use of CaseDesk, provided by CHK Immigration Services Inc.",
    features: [
      {
        icon: "document",
        h3: "Acceptance, by using it.",
        h4: "Who these Terms bind",
        body: "By creating an account or otherwise using the Service, you agree to these Terms on behalf of yourself and, where applicable, the immigration consulting workplace (\"Workplace\") you represent.",
      },
      {
        icon: "handshake",
        h3: "What CaseDesk does.",
        h4: "The Service, defined",
        body: "CaseDesk is a case-management platform that helps immigration consulting Workplaces manage clients, cases, documents, communications, billing, and related workflows. Certain features rely on optional third-party integrations that a Workplace may choose to connect.",
      },
    ],
    quickFacts: [
      { title: "QuickBooks", text: "Accounting, invoicing, and payment processing, where a Workplace connects a QuickBooks account." },
      { title: "Ooma, via Zapier", text: "SMS and call communications, where a Workplace enables this integration." },
      { title: "Microsoft 365", text: "Personal mailbox connections, where an individual user connects one." },
    ],
  },
  {
    id: "accounts-eligibility",
    navLabel: "Accounts & Eligibility",
    title: "Access, your responsibility.",
    tagline: "Using CaseDesk means keeping your own corner of it secure and accurate.",
    features: [
      {
        icon: "fingerprint",
        h3: "Authorized, by a Workplace.",
        h4: "Who can use the Service",
        body: "You must be authorized by a Workplace to use the Service on its behalf.",
      },
      {
        icon: "lock",
        h3: "Credentials, yours to protect.",
        h4: "Account activity is on you",
        body: "You're responsible for maintaining the confidentiality of your login credentials and for all activity under your account.",
      },
    ],
    quickFacts: [
      { title: "Accurate information", text: "You must provide accurate account information and keep it up to date." },
    ],
  },
  {
    id: "workplace-responsibility",
    navLabel: "Workplace Responsibility",
    title: "Client data, your obligation.",
    tagline: "Workplaces own the responsibility for the client data they put into CaseDesk — we process it, we don't police it.",
    features: [
      {
        icon: "gavel",
        h3: "Lawful basis, required.",
        h4: "Before data goes in",
        body: "A Workplace is solely responsible for having a lawful basis to collect, enter, and process its clients' personal information within CaseDesk, and for the accuracy of the information it enters.",
      },
      {
        icon: "scale",
        h3: "Compliance, on the Workplace.",
        h4: "Including immigration-practice regulation",
        body: "A Workplace is responsible for complying with all applicable laws, including privacy and immigration-practice regulations, in its use of the Service. CaseDesk acts as a data processor for this information and does not independently verify its accuracy or legality.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "payments-billing",
    navLabel: "Payments & Billing",
    title: "Billing, kept separate.",
    tagline: "CaseDesk's own commercial terms with a Workplace are distinct from the client billing a Workplace manages inside the platform.",
    features: [
      {
        icon: "document",
        h3: "Our billing, separately agreed.",
        h4: "Not set by these Terms",
        body: "Billing arrangements between CHK Immigration Services Inc. and a Workplace for use of CaseDesk itself are set out in the Workplace's separate service agreement with us — these Terms don't create new billing obligations.",
      },
      {
        icon: "check",
        h3: "Your clients' billing, in-platform.",
        h4: "Via the QuickBooks integration",
        body: "Where a Workplace connects QuickBooks, CaseDesk lets it manage invoicing and payment processing for its own clients. That integration is subject to Intuit/QuickBooks' own terms as well.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "intellectual-property",
    navLabel: "Intellectual Property",
    title: "Ownership, defined.",
    tagline: "The platform is ours. What a Workplace puts into it stays theirs.",
    features: [
      {
        icon: "gavel",
        h3: "The platform, ours.",
        h4: "Software, design, branding",
        body: "CaseDesk and its underlying software, design, and branding are owned by CHK Immigration Services Inc. and are protected by applicable intellectual property laws. These Terms don't grant you any ownership rights in the Service.",
      },
      {
        icon: "check",
        h3: "Your data, your data.",
        h4: "Workplace-entered content stays the Workplace's",
        body: "Data a Workplace enters into CaseDesk remains the property of that Workplace.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "prohibited-conduct",
    navLabel: "Prohibited Conduct",
    title: "Conduct, restricted.",
    tagline: "A short list of what you agree not to do while using CaseDesk.",
    features: [
      {
        icon: "shield",
        h3: "Unauthorized access, off-limits.",
        h4: "Yours, and no one else's",
        body: "You agree not to attempt to gain unauthorized access to any account, data, or system not belonging to you, or to interfere with or disrupt the integrity or performance of the Service.",
      },
    ],
    quickFacts: [
      { title: "Lawful use only", text: "No use of the Service for any unlawful purpose or in violation of any applicable regulation governing immigration consulting." },
      { title: "No malicious code", text: "No uploading malicious code or attempting to reverse-engineer the Service." },
    ],
  },
  {
    id: "termination",
    navLabel: "Termination",
    title: "Access, revoked.",
    tagline: "Access to CaseDesk can end — by us, for cause, or by a Workplace, whenever it chooses.",
    features: [
      {
        icon: "gavel",
        h3: "Suspended, for cause.",
        h4: "Violations or security risk",
        body: "We may suspend or terminate access to the Service for any account that violates these Terms or poses a security risk to the Service or other users.",
      },
      {
        icon: "document",
        h3: "Ended, by a Workplace.",
        h4: "Any time, with data handled per our Privacy Policy",
        body: "A Workplace may stop using the Service at any time; certain data may be retained after termination as described in our Privacy Policy or as required by law.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "disclaimers-liability",
    navLabel: "Disclaimers & Liability",
    title: "Risk, limited.",
    tagline: "CaseDesk is provided as-is, and our liability for its use is capped by law where permitted.",
    features: [
      {
        icon: "shield",
        h3: "Provided as-is.",
        h4: "No uptime or integration guarantee",
        body: "The Service is provided \"as is\" and \"as available\" without warranties of any kind, express or implied. We don't warrant that the Service will be uninterrupted, error-free, or that any integration (including QuickBooks) will always function without disruption.",
      },
      {
        icon: "scale",
        h3: "Liability, capped.",
        h4: "To the extent the law allows",
        body: "To the fullest extent permitted by law, CHK Immigration Services Inc. will not be liable for any indirect, incidental, special, or consequential damages arising from use of, or inability to use, the Service.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "governing-law",
    navLabel: "Governing Law",
    title: "Disputes, governed.",
    tagline: "Ontario law applies, wherever you're using CaseDesk from.",
    features: [
      {
        icon: "scale",
        h3: "Ontario, and federal Canadian law.",
        h4: "Governing jurisdiction",
        body: "These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable therein, without regard to conflict-of-law principles.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "changes-to-terms",
    navLabel: "Changes to Terms",
    title: "Updates, communicated.",
    tagline: "Using CaseDesk after a change means you've accepted it.",
    features: [
      {
        icon: "check",
        h3: "Continued use, accepted.",
        h4: "After a change takes effect",
        body: "We may update these Terms from time to time. We'll update the \"Last updated\" date above when we do. Continued use of the Service after a change constitutes acceptance of the updated Terms.",
      },
    ],
    quickFacts: [],
  },
];

export default function TermsOfService() {
  return (
    <LegalPageShell
      headline="The Rules, Made Clear."
      lastUpdated="July 23, 2026"
      summary="What using CaseDesk means for you and your Workplace — plain terms, no surprises."
      sections={SECTIONS}
      otherPage={{ to: "/legal/privacy", label: "Privacy Policy" }}
      contact={{
        heading: "Questions, welcomed.",
        body: "For anything about these Terms, reach out directly.",
        email: "gsdhillon@chkimmigration.ca",
        ctaLabel: "Contact our legal team",
      }}
    />
  );
}
