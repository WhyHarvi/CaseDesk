import LegalPageLayout from "./LegalPageLayout";

const h2 = "text-lg font-semibold text-slate-900";
const ul = "list-disc space-y-1.5 pl-5";

export default function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="July 21, 2026">
      <p>
        CaseDesk ("CaseDesk", "we", "us", or "our") is a case-management platform for immigration
        consulting practices, operated by <strong>CHK Immigration Services Inc.</strong>, a company
        based in Ontario, Canada. This Privacy Policy explains what personal information we collect
        through CaseDesk, how it is used, and the choices available to you.
      </p>
      <p>
        CaseDesk is used by immigration consulting agencies ("Agencies") to manage their own clients'
        immigration cases. When an Agency uses CaseDesk, CaseDesk acts as a data processor on the
        Agency's behalf for the client and case information the Agency enters. The Agency remains
        responsible for the accuracy of that information and for having a lawful basis to collect and
        share it with us.
      </p>

      <section className="space-y-2">
        <h2 className={h2}>1. Information We Collect</h2>
        <p>Depending on how CaseDesk is used, we may collect:</p>
        <ul className={ul}>
          <li><strong>Account information:</strong> name, email address, role, and login credentials for Agency staff and administrators.</li>
          <li><strong>Client and case information:</strong> data an Agency enters about its own clients to manage immigration applications — this can include names, contact details, immigration status, identity document details, family information, employment and education history, and other information relevant to an immigration case.</li>
          <li><strong>Communications:</strong> messages, notes, and documents exchanged within CaseDesk between Agency staff and clients, including through connected phone/SMS or email integrations an Agency chooses to enable.</li>
          <li><strong>Payment and billing records:</strong> invoice, payment status, and billing information processed through our QuickBooks integration.</li>
          <li><strong>Technical information:</strong> IP address, browser/device information, and usage logs collected automatically to operate and secure the service.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>2. How We Use Information</h2>
        <ul className={ul}>
          <li>To provide, maintain, and secure the CaseDesk platform.</li>
          <li>To let Agencies manage their clients' immigration cases, documents, communications, and billing.</li>
          <li>To send account, security, and service-related notifications.</li>
          <li>To troubleshoot issues and improve the reliability of the service.</li>
          <li>To comply with legal obligations.</li>
        </ul>
        <p>We do not sell personal information, and we do not use client or case data to train AI or machine-learning models.</p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>3. Third-Party Service Providers</h2>
        <p>
          We rely on the following third-party service providers to operate CaseDesk. Each processes
          data only as needed to provide their respective service to us:
        </p>
        <ul className={ul}>
          <li><strong>Supabase</strong> — database hosting and file storage.</li>
          <li><strong>Railway</strong> — backend application hosting.</li>
          <li><strong>Vercel</strong> — frontend application hosting.</li>
          <li><strong>Intuit / QuickBooks</strong> — accounting, invoicing, and payment processing, where an Agency connects a QuickBooks account.</li>
          <li><strong>Ooma (via Zapier)</strong> — SMS and call communications, where an Agency enables this integration.</li>
          <li><strong>Microsoft 365</strong> — personal mailbox connections, where an individual user connects one.</li>
          <li>An Agency's own email server (SMTP/IMAP), where the Agency configures one for outbound and inbound mail.</li>
        </ul>
        <p>Some of these providers may store or process data outside of Canada. We take reasonable steps to ensure comparable protection of personal information wherever it is processed.</p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>4. Data Security</h2>
        <p>
          We use industry-standard safeguards, including encryption of sensitive credentials at rest,
          role-based access control, and tenant-scoped data isolation, to protect personal information
          against unauthorized access, loss, or misuse. No method of transmission or storage is
          completely secure, and we cannot guarantee absolute security.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>5. Data Retention</h2>
        <p>
          We retain personal information for as long as an Agency's account remains active, or as
          needed to provide the service, comply with legal obligations, resolve disputes, and enforce
          our agreements. An Agency may request deletion of its data by contacting us, subject to any
          retention required by law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>6. Your Rights</h2>
        <p>
          Under Canada's <em>Personal Information Protection and Electronic Documents Act (PIPEDA)</em>,
          individuals may request access to their personal information, challenge its accuracy and
          completeness, and have it amended as appropriate. Individuals may also withdraw consent,
          subject to legal or contractual restrictions and reasonable notice. You may ask us to delete
          information; we will assess the request against applicable retention requirements and the
          purposes for which the information is still required. Because CaseDesk is used by Agencies
          to manage their own clients, requests from an Agency's clients should generally be directed
          to that Agency first. You may also contact us directly using the details below, and you may
          file a complaint with the Office of the Privacy Commissioner of Canada.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>7. Children's Privacy</h2>
        <p>
          CaseDesk is intended for use by immigration consulting professionals and their clients. It is
          not directed at children, though case data entered by an Agency may include information
          about minors (e.g. dependants on a family's immigration application) as part of that Agency's
          casework.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>8. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will update the "Last updated" date
          above when we do. If a change materially affects how we collect, use, or disclose personal
          information, we will provide additional notice or obtain consent where required by law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>9. Contact Us</h2>
        <p>
          For questions about this Privacy Policy or how your information is handled, contact us at{" "}
          <a href="mailto:gsdhillon@chkimmigration.ca" className="text-sky-700 hover:underline">gsdhillon@chkimmigration.ca</a>.
        </p>
        <p>CHK Immigration Services Inc. — Ontario, Canada</p>
      </section>
    </LegalPageLayout>
  );
}
