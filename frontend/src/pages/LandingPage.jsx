import { useEffect, useLayoutEffect, useState } from 'react';
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
  const [isLoading, setIsLoading] = useState(true);

  // Force light mode on landing page, independent of cached theme preference
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const root = document.documentElement;
    const hadThemeDark = root.classList.contains('theme-dark');

    // Remove dark theme class to force light mode
    root.classList.remove('theme-dark');

    // Restore original theme state when leaving landing page
    return () => {
      if (hadThemeDark) {
        root.classList.add('theme-dark');
      }
    };
  }, []);

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
    // Simulate initial load time
    const timer = setTimeout(() => setIsLoading(false), 400);
    return () => clearTimeout(timer);
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

  if (isLoading) {
    return (
      <div className="landing-page">
        <div className="landing-shell">
          <header className="landing-topbar">
            <div className="landing-brand landing-skeleton-brand">
              <div className="skeleton skeleton-sm" />
              <div className="skeleton skeleton-sm" style={{ width: '6rem' }} />
            </div>
          </header>

          <main className="landing-main">
            {/* Hero Section Skeleton */}
            <section className="landing-hero landing-hero-skeleton">
              <div className="landing-copy">
                <div className="skeleton skeleton-lg" style={{ height: '3rem', marginBottom: '1rem' }} />
                <div className="skeleton" style={{ height: '1.5rem' }} />
                <div className="skeleton" style={{ height: '1.5rem', marginBottom: '0.5rem', width: '90%' }} />

                <div className="landing-actions" style={{ marginTop: '1.5rem' }}>
                  <div className="landing-auth-actions">
                    <div className="skeleton" style={{ height: '3rem' }} />
                    <div className="skeleton" style={{ height: '3rem' }} />
                  </div>
                </div>
              </div>

              <aside className="landing-panel">
                <div className="landing-panel-card">
                  <div className="skeleton skeleton-sm" style={{ marginBottom: '0.75rem', width: '60%' }} />
                  <div className="skeleton" style={{ height: '1.2rem', marginBottom: '0.5rem' }} />
                  <div className="skeleton" style={{ height: '1.2rem', marginBottom: '0.5rem' }} />
                  <div className="skeleton" style={{ height: '1.2rem', width: '80%' }} />
                </div>

                <div className="landing-panel-card">
                  <div className="skeleton skeleton-sm" style={{ marginBottom: '0.75rem', width: '60%' }} />
                  <div className="skeleton" style={{ height: '1.2rem', marginBottom: '0.5rem' }} />
                  <div className="skeleton" style={{ height: '1.2rem', width: '85%' }} />
                </div>
              </aside>
            </section>

            {/* Grid Section Skeleton */}
            <section className="landing-grid">
              <article className="landing-card">
                <div className="skeleton skeleton-sm" style={{ marginBottom: '0.75rem', width: '65%' }} />
                <div className="skeleton" style={{ height: '1.2rem', marginBottom: '0.5rem' }} />
                <div className="skeleton" style={{ height: '1.2rem', width: '90%' }} />
              </article>

              <article className="landing-card">
                <div className="skeleton skeleton-sm" style={{ marginBottom: '0.75rem', width: '65%' }} />
                <div className="skeleton" style={{ height: '1.2rem', marginBottom: '0.5rem' }} />
                <div className="skeleton" style={{ height: '1.2rem', width: '90%' }} />
              </article>
            </section>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="landing-page">
      <div className="landing-shell">
        <header className="landing-topbar">
          <Link to="/" className="landing-brand" aria-label="OneGapo home">
            <OneGapoLogo className="landing-brand-logo onegapo-logo-force-dark" decorative />
            <span>OneGapo</span>
          </Link>

        </header>

        <main className="landing-main">
          <section className="landing-hero">
            <div className="landing-copy">
              <h1 className="landing-title">Resident reports, kept in one place.</h1>
              <p className="landing-lead">
                OneGapo gives residents one place to file concerns, follow report status, and receive updates without
                chasing separate channels.
              </p>

              <div className="landing-actions">
                <div className="landing-auth-actions">
                  <Link to="/register" className="btn-primary landing-button landing-compact-button">Create account</Link>
                  <Link to="/login" className="btn-outline landing-button landing-compact-button">Sign in</Link>
                </div>
                {isMobile && (
                  <button type="button" onClick={handleInstall} className="btn-secondary landing-button landing-install-button">
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

            <aside className="landing-panel">
              <div className="landing-panel-card">
                <p className="landing-panel-title">What residents can do</p>
                <ul className="landing-feature-list">
                  <li>Send a report with location and photos.</li>
                  <li>Track submitted, in review, and resolved updates.</li>
                  <li>Keep the app on your phone like a native app.</li>
                </ul>
              </div>

              <div className="landing-panel-card landing-panel-card-soft">
                <p className="landing-panel-title">Built for mobile use</p>
                <p className="landing-panel-text">
                  The download button appears on phones so you can install OneGapo directly from the landing page.
                </p>
              </div>
            </aside>
          </section>

          <section className="landing-grid" aria-label="Platform highlights">
            <article className="landing-card">
              <h2 className="landing-card-title">Report faster</h2>
              <p className="landing-card-text">
                Capture the issue, location, and supporting details in one submission.
              </p>
            </article>

            <article className="landing-card">
              <h2 className="landing-card-title">Track progress</h2>
              <p className="landing-card-text">
                Follow status changes from submitted to resolved without re-entering the same information.
              </p>
            </article>
          </section>
        </main>
        <footer className="landing-footer" role="contentinfo">
          <div className="landing-footer-inner">
            <span>© {new Date().getFullYear()} OneGapo — All rights reserved.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}