import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import OneGapoLogo from '../components/OneGapoLogo';
import './LandingPage.css';

const MOBILE_QUERY = '(max-width: 767px)';

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return Boolean(window.navigator?.standalone);
}

export default function LandingPage() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });
  const [installMessage, setInstallMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const onChange = (event) => setIsMobile(event.matches);

    setIsMobile(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleBeforeInstallPrompt = (event) => {
      if (isStandaloneMode()) return;

      event.preventDefault();
      setDeferredPrompt(event);
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setInstallMessage('OneGapo is installed on your device.');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setInstallMessage('Open your browser menu and choose Add to Home Screen.');
      return;
    }

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    if (choiceResult?.outcome === 'accepted') {
      setInstallMessage('OneGapo is installing on your home screen.');
      return;
    }

    setInstallMessage('Install dismissed. You can try again anytime.');
  };

  return (
    <div className="landing-page">
      <div className="landing-shell">
        <header className="landing-topbar">
          <Link to="/" className="landing-brand" aria-label="OneGapo home">
            <OneGapoLogo className="landing-brand-logo" decorative />
            <span className="landing-brand-title">OneGapo</span>
          </Link>

          <nav className="landing-nav-actions" aria-label="Quick links">
            <Link to="/login" className="landing-nav-link">Sign in</Link>
            <Link to="/register" className="btn-primary landing-nav-btn">Get started</Link>
          </nav>
        </header>

        <main className="landing-main">
          {/* Main Hero Card */}
          <section className="landing-hero">
            <div className="landing-copy">
              <div className="landing-badge">
                <span className="landing-badge-dot" aria-hidden="true" />
                <span>Official Citizen Reporting Platform</span>
              </div>

              <h1 className="landing-title">
                Citizen reports, <br />
                <span className="landing-title-highlight">resolved faster together.</span>
              </h1>

              <p className="landing-lead">
                OneGapo connects Olongapo residents directly with city response teams. Submit issues with photos and GPS, track real-time resolution status, and stay informed without bureaucracy.
              </p>

              <div className="landing-actions">
                <Link to="/register" className="btn-primary landing-cta-primary">
                  <span>Create resident account</span>
                  <span className="material-symbols-outlined landing-cta-icon" aria-hidden="true">arrow_forward</span>
                </Link>

                <Link to="/login" className="landing-cta-secondary">
                  <span>Sign in</span>
                </Link>

                {isMobile && (
                  <button
                    type="button"
                    onClick={handleInstall}
                    className="landing-install-button"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">download</span>
                    <span>Download app</span>
                  </button>
                )}
              </div>

              {isMobile && (
                <p className="landing-install-note" aria-live="polite">
                  {installMessage || 'Install the PWA to keep OneGapo on your home screen.'}
                </p>
              )}
            </div>

            {/* Live Activity Mockup Preview */}
            <aside className="landing-preview" aria-label="Live resolution preview">
              <div className="landing-preview-header">
                <div className="landing-preview-title-wrap">
                  <span className="landing-preview-indicator" />
                  <span className="landing-preview-heading">Live Citizen Feed</span>
                </div>
                <span className="landing-preview-tag">Olongapo City</span>
              </div>

              <div className="landing-feed-list">
                <div className="landing-feed-item">
                  <div className="landing-feed-top">
                    <span className="landing-feed-status status-resolved">
                      <span className="status-dot" /> Resolved
                    </span>
                    <span className="landing-feed-time">12m ago</span>
                  </div>
                  <p className="landing-feed-title">Streetlight outage repaired</p>
                  <p className="landing-feed-sub">Barangay Barretto • Public Safety</p>
                </div>

                <div className="landing-feed-item">
                  <div className="landing-feed-top">
                    <span className="landing-feed-status status-progress">
                      <span className="status-dot" /> In Progress
                    </span>
                    <span className="landing-feed-time">1h ago</span>
                  </div>
                  <p className="landing-feed-title">Drainage clearance crew dispatched</p>
                  <p className="landing-feed-sub">East Bajac-Bajac • Sanitation</p>
                </div>

                <div className="landing-feed-item">
                  <div className="landing-feed-top">
                    <span className="landing-feed-status status-review">
                      <span className="status-dot" /> Under Review
                    </span>
                    <span className="landing-feed-time">3h ago</span>
                  </div>
                  <p className="landing-feed-title">Road surface pothole inspection</p>
                  <p className="landing-feed-sub">Gordon Heights • Infrastructure</p>
                </div>
              </div>
            </aside>
          </section>

          {/* Value Proposition Highlights */}
          <section className="landing-grid" aria-label="Platform highlights">
            <article className="landing-card">
              <div className="landing-card-icon-wrap">
                <span className="material-symbols-outlined" aria-hidden="true">pin_drop</span>
              </div>
              <h2 className="landing-card-title">Precise Geotagging</h2>
              <p className="landing-card-text">
                Pin the exact road, corner, or facility with photos. Staff know immediately where to dispatch without manual guesswork.
              </p>
            </article>

            <article className="landing-card">
              <div className="landing-card-icon-wrap">
                <span className="material-symbols-outlined" aria-hidden="true">visibility</span>
              </div>
              <h2 className="landing-card-title">Transparent Tracking</h2>
              <p className="landing-card-text">
                Follow your report from initial review to completion with verifiable timeline updates and direct responder notes.
              </p>
            </article>

            <article className="landing-card">
              <div className="landing-card-icon-wrap">
                <span className="material-symbols-outlined" aria-hidden="true">devices</span>
              </div>
              <h2 className="landing-card-title">Instant Mobile Access</h2>
              <p className="landing-card-text">
                Lightweight Progressive Web App that works seamlessly on any device. Install directly to your home screen with zero app store hassle.
              </p>
            </article>
          </section>
        </main>

        <footer className="landing-footer" role="contentinfo">
          <div className="landing-footer-inner">
            <div className="landing-footer-copy">
              <span>© {new Date().getFullYear()} OneGapo. Civic Reporting Platform for Olongapo City.</span>
            </div>
            <div className="landing-footer-links">
              <Link to="/terms" className="landing-footer-link">Terms</Link>
              <span className="landing-footer-sep">•</span>
              <Link to="/privacy" className="landing-footer-link">Privacy</Link>
              <span className="landing-footer-sep">•</span>
              <Link to="/legal" className="landing-footer-link">Legal Notice</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}