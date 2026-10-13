import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { PublicTop } from "../components/PublicTop";
import { Eyebrow } from "../components/ui";
import { setPageMeta } from "../lib/meta";
import { SEO } from "../seo";

const UPDATED = "13 October 2026";
const CONTACT = "hello@usethemis.dev";

const Legal = ({ path, title, intro, children }: { path: "/privacy" | "/terms"; title: string; intro: string; children: ReactNode }) => {
  useEffect(() => setPageMeta(SEO[path].title, true, SEO[path].description), [path]);
  return (
    <div className="public">
      <PublicTop />
      <main className="page legal-page">
        <header className="page-header">
          <div>
            <Eyebrow>Legal</Eyebrow>
            <h1>{title}</h1>
            <p className="muted">{intro}</p>
          </div>
          <span className="muted small mono legal-updated">Updated {UPDATED}</span>
        </header>
        <div className="panel legal-panel">{children}</div>
        <footer className="legal-foot">
          <Link to="/privacy" className={path === "/privacy" ? "active" : undefined}>
            Privacy policy
          </Link>
          <Link to="/terms" className={path === "/terms" ? "active" : undefined}>
            Terms of service
          </Link>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </footer>
      </main>
    </div>
  );
};

// one topic: its heading on the left, the text on the right, as in Settings
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="legal-section">
    <h2>{title}</h2>
    <div className="legal-body">{children}</div>
  </section>
);

// What Themis stores, why, for how long and who else sees it, described from what the app actually does
export const PrivacyPage = () => (
  <Legal
    path="/privacy"
    title="Privacy policy"
    intro="Themis is a workspace for testing, monitoring and validating APIs. This page explains what we store about you when you use usethemis.dev, why, and what you can do about it."
  >
    <Section title="What we collect">
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address and optional username. Passwords are stored only as a salted scrypt hash; we never see or
          keep the password itself.
        </li>
        <li>
          <strong>Google sign-in:</strong> if you continue with Google, we receive your name, email address and Google account ID. We don't receive your Google
          password or access to anything else in your Google account.
        </li>
        <li>
          <strong>What you create:</strong> requests, collections, environments and variables, monitors, contracts and status page settings.
        </li>
        <li>
          <strong>Results:</strong> the responses to requests you send (bodies up to 1 MB), monitor checks, incidents and contract validations. For uploaded
          files, request history keeps only the file name and size, not the contents.
        </li>
        <li>
          <strong>Sign-in sessions:</strong> a session record with your browser's user agent and IP address, so you can stay signed in and we can protect your
          account.
        </li>
      </ul>
    </Section>

    <Section title="How we use it">
      <p>
        Only to run Themis for you: sending your requests, running your monitors, alerting the webhooks you configure, validating responses and showing you the
        results. We don't sell your data, show ads, or use your data to train AI models.
      </p>
    </Section>

    <Section title="Who else processes it">
      <ul>
        <li>
          <strong>Groq</strong> generates AI summaries when you ask for one. It receives a summary of the relevant run or monitor, such as status codes,
          timings, error messages and response excerpts, with passwords, tokens and other secrets removed first.
        </li>
        <li>
          <strong>Google</strong>, if you choose to sign in with Google.
        </li>
        <li>
          <strong>Our hosting providers</strong>, which run the website, the API and the database.
        </li>
        <li>
          <strong>The APIs and webhooks you point Themis at</strong> receive the requests and alerts you configure. Their handling of that data is governed by
          their own policies.
        </li>
        <li>
          <strong>Anyone with your status page address</strong> can see the monitor names, uptime and incident times you choose to publish, never URLs or error
          details.
        </li>
      </ul>
    </Section>

    <Section title="Cookies">
      <p>
        We use one cookie to keep you signed in, and a short-lived one while you sign in with Google. There are no analytics, advertising or tracking cookies.
        Your browser also stores a few preferences locally, such as your sidebar state and current draft request.
      </p>
    </Section>

    <Section title="How long we keep it">
      <p>
        Monitor checks and contract validations are deleted automatically after 90 days. Everything else stays until you delete it or delete your account.
        Deleting your account in Settings permanently removes your account and everything in it.
      </p>
    </Section>

    <Section title="Your choices">
      <p>
        You can edit your profile, delete anything you've created, and delete your account at any time in Settings. For anything else, including a copy of your
        data, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Section>

    <Section title="Security">
      <p>
        Data is sent over HTTPS, sessions use secure HTTP-only cookies, and every query is scoped to your account so other users can't see your data. No system
        is perfectly secure, so please don't store secrets you can't afford to rotate.
      </p>
    </Section>

    <Section title="Changes">
      <p>If we change this policy in a way that matters, we'll update the date above and tell you in the app or by email.</p>
    </Section>
  </Legal>
);

export const TermsPage = () => (
  <Legal
    path="/terms"
    title="Terms of service"
    intro="These terms apply when you use Themis at usethemis.dev. By creating an account or using the service, you agree to them."
  >
    <Section title="Your account">
      <p>
        You're responsible for your account and for keeping your sign-in details safe. You must give accurate details and be old enough to agree to these terms
        where you live.
      </p>
    </Section>

    <Section title="Using Themis">
      <p>Themis sends HTTP requests on your behalf. Only test and monitor APIs you own or are allowed to use. You agree not to use Themis to:</p>
      <ul>
        <li>probe, scan or attack systems or networks you don't have permission to test, including internal or private networks;</li>
        <li>overload any service, get around rate limits, or run monitors more often than the target allows;</li>
        <li>send spam, malware, or anything illegal or infringing;</li>
        <li>interfere with Themis itself or other users' data.</li>
      </ul>
      <p>We may suspend or close accounts that break these rules.</p>
    </Section>

    <Section title="Your content">
      <p>
        What you create in Themis stays yours. You give us permission to store and process it only as needed to run the service for you. You're responsible for
        the requests you send and the data you put into Themis.
      </p>
    </Section>

    <Section title="Availability">
      <p>
        We work to keep Themis running, but it's provided as is, without guarantees of uptime or that every check, alert or summary will be accurate or on time.
        Don't rely on it as your only alerting for critical systems.
      </p>
    </Section>

    <Section title="Limitation of liability">
      <p>
        To the extent the law allows, Themis and its maintainers aren't liable for indirect or consequential losses, or for lost data, profits or revenue, from
        your use of the service.
      </p>
    </Section>

    <Section title="Ending your use">
      <p>You can stop using Themis and delete your account at any time in Settings. We may end or change the service with reasonable notice.</p>
    </Section>

    <Section title="Changes">
      <p>If we change these terms in a way that matters, we'll update the date above and tell you before the changes take effect.</p>
    </Section>

    <Section title="Contact">
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Section>
  </Legal>
);
