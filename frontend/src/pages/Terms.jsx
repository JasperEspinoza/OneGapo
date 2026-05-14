import './Legal.css';
import { Link } from 'react-router-dom';
import { termsSections } from './legalContent';

function LegalSection({ title, body }) {
  return (
    <section className="legal-section">
      <h2 className="legal-section-title">{title}</h2>
      <p className="legal-section-body">{body}</p>
    </section>
  );
}

export default function Terms() {
  return (
    <div className="legal-page">
      <div className="legal-shell">
        <header className="legal-header">
          <div>
            <p className="legal-kicker">OneGapo legal notice</p>
            <h1 className="legal-title">Terms and Conditions</h1>
            <p className="legal-summary">
              These terms explain how OneGapo works and what you agree to when using the reporting platform.
            </p>
          </div>
          <Link to="/register" className="legal-back-link">
            Back to registration
          </Link>
        </header>

        <section className="legal-card legal-card-single">
          <p className="legal-card-updated">Last Updated: May 14, 2026</p>
          <div className="legal-stack">
            {termsSections.map((section) => (
              <LegalSection key={section.title} title={section.title} body={section.body} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
