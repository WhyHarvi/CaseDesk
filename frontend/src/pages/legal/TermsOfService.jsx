import LegalPageLayout from "./LegalPageLayout";

const h2 = "text-lg font-semibold text-slate-900";
const ul = "list-disc space-y-1.5 pl-5";

export default function TermsOfService() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="July 21, 2026">
      <p>
        These Terms of Service ("Terms") govern access to and use of CaseDesk (the "Service"),
        provided by <strong>CHK Immigration Services Inc.</strong> ("CaseDesk", "we", "us", or "our"),
        a company based in Ontario, Canada. By creating an account or otherwise using the Service, you
        agree to these Terms on behalf of yourself and, where applicable, the immigration consulting
        agency ("Agency") you represent.
      </p>

      <section className="space-y-2">
        <h2 className={h2}>1. The Service</h2>
        <p>
          CaseDesk is a case-management platform that helps immigration consulting Agencies manage
          clients, cases, documents, communications, billing, and related workflows. Certain features
          rely on optional third-party integrations (for example QuickBooks, Ooma, or Microsoft 365)
          that an Agency may choose to connect.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>2. Accounts and Eligibility</h2>
        <ul className={ul}>
          <li>You must be authorized by an Agency to use the Service on its behalf.</li>
          <li>You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.</li>
          <li>You must provide accurate account information and keep it up to date.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>3. Agency Responsibility for Client Data</h2>
        <p>
          An Agency is solely responsible for: (a) having a lawful basis to collect, enter, and process
          its clients' personal information within CaseDesk; (b) the accuracy of information it enters;
          and (c) complying with all applicable laws, including privacy and immigration-practice
          regulations, in its use of the Service. CaseDesk acts as a data processor for this information
          and does not independently verify its accuracy or legality.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul className={ul}>
          <li>Use the Service for any unlawful purpose or in violation of any applicable regulation governing immigration consulting.</li>
          <li>Attempt to gain unauthorized access to any account, data, or system not belonging to you.</li>
          <li>Interfere with or disrupt the integrity or performance of the Service.</li>
          <li>Upload malicious code or attempt to reverse-engineer the Service.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>5. Third-Party Integrations</h2>
        <p>
          The Service may connect to third-party providers such as Intuit/QuickBooks, Ooma (via
          Zapier), and Microsoft 365, at an Agency's or user's election. Use of any connected
          third-party service is also subject to that provider's own terms and privacy policy. We are
          not responsible for the acts or omissions of third-party providers.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>6. Intellectual Property</h2>
        <p>
          CaseDesk and its underlying software, design, and branding are owned by CHK Immigration
          Services Inc. and are protected by applicable intellectual property laws. These Terms do not
          grant you any ownership rights in the Service. Data an Agency enters into CaseDesk remains
          the property of that Agency.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>7. Termination</h2>
        <p>
          We may suspend or terminate access to the Service for any account that violates these Terms
          or poses a security risk to the Service or other users. An Agency may stop using the Service
          at any time; certain data may be retained after termination as described in our Privacy
          Policy or as required by law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>8. Disclaimer of Warranties</h2>
        <p>
          The Service is provided "as is" and "as available" without warranties of any kind, express or
          implied. We do not warrant that the Service will be uninterrupted, error-free, or that any
          integration (including QuickBooks) will always function without disruption.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>9. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, CHK Immigration Services Inc. will not be liable for
          any indirect, incidental, special, or consequential damages arising from use of, or inability
          to use, the Service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>10. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the Province of Ontario and the federal laws of
          Canada applicable therein, without regard to conflict-of-law principles.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>11. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will update the "Last updated" date above
          when we do. Continued use of the Service after a change constitutes acceptance of the updated
          Terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className={h2}>12. Contact Us</h2>
        <p>
          Questions about these Terms can be sent to{" "}
          <a href="mailto:gsdhillon@chkimmigration.ca" className="text-sky-700 hover:underline">gsdhillon@chkimmigration.ca</a>.
        </p>
        <p>CHK Immigration Services Inc. — Ontario, Canada</p>
      </section>
    </LegalPageLayout>
  );
}
