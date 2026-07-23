import LegalPageShell from "./LegalPageShell";

const SECTIONS = [
  {
    id: "overview",
    navLabel: "Overview",
    title: "What this covers.",
    tagline: "CaseDesk is a case-management platform for immigration consulting practices, operated by CHK Immigration Services Inc.",
    features: [
      {
        icon: "shield",
        h3: "Your data, in context.",
        h4: "Who this policy is for",
        body: "This Privacy Policy explains what personal information CaseDesk collects, how it's used, and the choices available to you as a member of an Agency's staff or as that Agency's client.",
      },
      {
        icon: "handshake",
        h3: "Agencies, responsible.",
        h4: "How CaseDesk fits in",
        body: "CaseDesk is used by immigration consulting agencies (\"Agencies\") to manage their own clients' immigration cases. When an Agency uses CaseDesk, we act as a data processor on the Agency's behalf. The Agency remains responsible for the accuracy of the information it enters and for having a lawful basis to collect and share it with us.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "data-we-collect",
    navLabel: "Data We Collect",
    title: "What we collect, upfront.",
    tagline: "Depending on how CaseDesk is used, we collect a defined set of information — nothing beyond what the service needs to run.",
    features: [
      {
        icon: "fingerprint",
        h3: "Account information.",
        h4: "Agency staff & admins",
        body: "Name, email address, role, and login credentials for Agency staff and administrators.",
      },
      {
        icon: "document",
        h3: "Client & case information.",
        h4: "What an Agency enters",
        body: "Names, contact details, immigration status, identity document details, family information, employment and education history, and other information relevant to an immigration case, entered by the Agency about its own clients.",
      },
      {
        icon: "eye",
        h3: "Communications.",
        h4: "Messages, notes, documents",
        body: "Exchanged within CaseDesk between Agency staff and clients, including through connected phone/SMS or email integrations an Agency chooses to enable.",
      },
      {
        icon: "check",
        h3: "Payment & billing records.",
        h4: "Via our QuickBooks integration",
        body: "Invoice, payment status, and billing information processed through our QuickBooks integration, where an Agency connects one.",
      },
    ],
    quickFacts: [
      { title: "Technical information", text: "IP address, browser/device information, and usage logs, collected automatically to operate and secure the service." },
    ],
  },
  {
    id: "how-we-use-it",
    navLabel: "How We Use It",
    title: "Your data, purposeful.",
    tagline: "Every use of your information ties back to running CaseDesk for the Agency you work with or belong to.",
    features: [
      {
        icon: "shield",
        h3: "Run the platform.",
        h4: "Provide, maintain, secure",
        body: "To provide, maintain, and secure the CaseDesk platform, and to troubleshoot issues and improve its reliability.",
      },
      {
        icon: "handshake",
        h3: "Power agency casework.",
        h4: "Cases, documents, billing",
        body: "To let Agencies manage their clients' immigration cases, documents, communications, and billing, and to send account, security, and service-related notifications.",
      },
    ],
    quickFacts: [
      { title: "Legal compliance", text: "We use information as needed to comply with applicable legal obligations." },
      { title: "No selling, no AI training", text: "We do not sell personal information, and we do not use client or case data to train AI or machine-learning models." },
    ],
  },
  {
    id: "cookies",
    navLabel: "Cookies & Storage",
    title: "Sign-in, remembered.",
    tagline: "CaseDesk isn't an advertising product — what little storage we use is there to keep you signed in.",
    features: [
      {
        icon: "lock",
        h3: "Local storage, not tracking.",
        h4: "How you stay signed in",
        body: "CaseDesk uses your browser's local storage to keep you signed in between visits. We do not use advertising or analytics tracking cookies, and we do not track you across other websites.",
      },
    ],
    quickFacts: [
      { title: "Disabling storage", text: "Blocking local storage in your browser will prevent CaseDesk from keeping you signed in, since that's the only thing it's used for." },
    ],
  },
  {
    id: "third-party-sharing",
    navLabel: "Third-Party Sharing",
    title: "Vendors, vetted.",
    tagline: "We rely on a defined set of third-party providers to operate CaseDesk — each processes data only as needed to provide their service to us.",
    features: [
      {
        icon: "document",
        h3: "Infrastructure providers.",
        h4: "Supabase, Railway, Cloudflare Pages",
        body: "Supabase provides database hosting and file storage, Railway hosts our backend application, and Cloudflare Pages hosts our frontend application.",
      },
      {
        icon: "check",
        h3: "Optional integrations.",
        h4: "Connected only if an Agency enables them",
        body: "Intuit/QuickBooks for accounting, invoicing, and payment processing; Ooma (via Zapier) for SMS and calls; Microsoft 365 for personal mailbox connections — each only where an Agency or individual user chooses to connect it.",
      },
    ],
    quickFacts: [
      { title: "Agency email servers", text: "An Agency's own email server (SMTP/IMAP), where the Agency configures one for outbound and inbound mail." },
      { title: "Cross-border processing", text: "Some of these providers may store or process data outside of Canada. We take reasonable steps to ensure comparable protection wherever it's processed." },
    ],
  },
  {
    id: "your-rights",
    navLabel: "Your Rights",
    title: "Access, protected.",
    tagline: "Under Canada's Personal Information Protection and Electronic Documents Act (PIPEDA), you have real, enforceable rights over your information.",
    features: [
      {
        icon: "eye",
        h3: "Access & correction.",
        h4: "Challenge accuracy, request amendment",
        body: "You may request access to your personal information, challenge its accuracy and completeness, and have it amended as appropriate.",
      },
      {
        icon: "check",
        h3: "Consent & deletion.",
        h4: "Withdraw, or ask us to delete",
        body: "You may withdraw consent, subject to legal or contractual restrictions and reasonable notice, and you may ask us to delete information — we'll assess the request against applicable retention requirements and the purposes it's still needed for.",
      },
    ],
    quickFacts: [
      { title: "Agencies first", text: "Because CaseDesk is used by Agencies to manage their own clients, requests from an Agency's clients should generally be directed to that Agency first." },
      { title: "File a complaint", text: "You may contact us directly using the details below, and you may file a complaint with the Office of the Privacy Commissioner of Canada." },
    ],
  },
  {
    id: "data-security",
    navLabel: "Data Security",
    title: "Data, safeguarded.",
    tagline: "Industry-standard safeguards protect personal information for as long as it needs to exist inside CaseDesk.",
    features: [
      {
        icon: "lock",
        h3: "Safeguards in place.",
        h4: "Encryption, access control, isolation",
        body: "Encryption of sensitive credentials at rest, role-based access control, and tenant-scoped data isolation protect personal information against unauthorized access, loss, or misuse.",
      },
      {
        icon: "document",
        h3: "Retention, tied to use.",
        h4: "As long as the account is active",
        body: "We retain personal information for as long as an Agency's account remains active, or as needed to provide the service, comply with legal obligations, resolve disputes, and enforce our agreements.",
      },
    ],
    quickFacts: [
      { title: "No absolute guarantee", text: "No method of transmission or storage is completely secure, and we cannot guarantee absolute security." },
      { title: "Requesting deletion", text: "An Agency may request deletion of its data by contacting us, subject to any retention required by law." },
    ],
  },
  {
    id: "international-transfers",
    navLabel: "International Transfers",
    title: "Borders, considered.",
    tagline: "CaseDesk's providers aren't all based in Canada — here's what that means for your data.",
    features: [
      {
        icon: "shield",
        h3: "Cross-border, protected.",
        h4: "Comparable protection, wherever processed",
        body: "Some of our third-party service providers may store or process data outside of Canada. We take reasonable steps to ensure personal information receives comparable protection wherever it's processed, regardless of location.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "childrens-privacy",
    navLabel: "Children's Privacy",
    title: "Minors, in context.",
    tagline: "CaseDesk itself isn't built for children — but immigration casework sometimes involves them.",
    features: [
      {
        icon: "fingerprint",
        h3: "Not directed at children.",
        h4: "But dependants may appear in case data",
        body: "CaseDesk is intended for use by immigration consulting professionals and their clients. It is not directed at children, though case data entered by an Agency may include information about minors — for example, dependants on a family's immigration application — as part of that Agency's casework.",
      },
    ],
    quickFacts: [],
  },
  {
    id: "policy-changes",
    navLabel: "Policy Changes",
    title: "Updates, communicated.",
    tagline: "This policy isn't static — here's how you'll know when it changes.",
    features: [
      {
        icon: "check",
        h3: "We'll tell you when it matters.",
        h4: "Especially for material changes",
        body: "We may update this Privacy Policy from time to time. We'll update the \"Last updated\" date above when we do. If a change materially affects how we collect, use, or disclose personal information, we'll provide additional notice or obtain consent where required by law.",
      },
    ],
    quickFacts: [],
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalPageShell
      headline="Your Data, Your Terms."
      lastUpdated="July 23, 2026"
      summary="How CaseDesk collects, uses, and protects personal information — for Agency staff and the clients they serve."
      sections={SECTIONS}
      otherPage={{ to: "/legal/terms", label: "Terms of Service" }}
      contact={{
        heading: "Questions, welcomed.",
        body: "For anything about this Privacy Policy or how your information is handled, reach out directly.",
        email: "gsdhillon@chkimmigration.ca",
        ctaLabel: "Contact our privacy team",
      }}
    />
  );
}
