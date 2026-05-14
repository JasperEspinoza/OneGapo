import './Legal.css';
import { Link } from 'react-router-dom';
import { privacySections } from './legalContent';

function LegalSection({ title, body }) {
  return (
    <section className="legal-section">
      <h2 className="legal-section-title">{title}</h2>
      <p className="legal-section-body">{body}</p>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="legal-page">
      <div className="legal-shell">
        <header className="legal-header">
          <div>
            <p className="legal-kicker">OneGapo legal notice</p>
            <h1 className="legal-title">Privacy Policy</h1>
            <p className="legal-summary">
              This policy explains what information OneGapo collects, how it is used, and how it is protected.
            </p>
          </div>
          <Link to="/register" className="legal-back-link">
            Back to registration
          </Link>
        </header>

        <section className="legal-card legal-card-single">
          <p className="legal-card-updated">Last Updated: May 14, 2026</p>
          <div className="legal-stack">
            {privacySections.map((section) => (
              <LegalSection key={section.title} title={section.title} body={section.body} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
