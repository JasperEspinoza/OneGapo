import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DISMISS_KEY = 'onegapo:pwa-install-dismissed-at';
const DISMISS_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MOBILE_QUERY = '(max-width: 768px)';

function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return Boolean(window.navigator?.standalone);
}

function isDismissedRecently() {
  if (typeof window === 'undefined') return false;

  const raw = window.localStorage.getItem(DISMISS_KEY);
  const dismissedAt = Number(raw);
  if (!Number.isFinite(dismissedAt) || dismissedAt <= 0) return false;
  return Date.now() - dismissedAt < DISMISS_TTL_MS;
}

export default function PwaInstallPrompt() {
  const location = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
  });
  const [isVisible, setIsVisible] = useState(false);
  const isPublicLandingRoute =
    location.pathname === '/' ||
    location.pathname === '/login' ||
    location.pathname === '/register' ||
    location.pathname === '/forgot-password' ||
    location.pathname === '/verify-email';

  useEffect(() => {
    if (isPublicLandingRoute) return undefined;

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
    if (isPublicLandingRoute) return undefined;

    if (typeof window === 'undefined') return undefined;

    const handleBeforeInstallPrompt = (event) => {
      if (isStandaloneMode() || isDismissedRecently()) return;
      event.preventDefault();
      setDeferredPrompt(event);
      setIsVisible(true);
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsVisible(false);
      window.localStorage.removeItem(DISMISS_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const hidePrompt = useCallback(() => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setIsVisible(false);
  }, []);

  const installApp = useCallback(async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const choiceResult = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    if (choiceResult?.outcome !== 'accepted') {
      hidePrompt();
      return;
    }

    setIsVisible(false);
  }, [deferredPrompt, hidePrompt]);

  const shouldRender = useMemo(
    () => !isPublicLandingRoute && isMobile && isVisible && !isStandaloneMode() && Boolean(deferredPrompt),
    [deferredPrompt, isMobile, isPublicLandingRoute, isVisible]
  );

  if (!shouldRender) return null;

  return (
    <section className="pwa-install-sheet" role="dialog" aria-labelledby="pwa-install-title">
      <div className="pwa-install-sheet-logo-wrap" aria-hidden="true">
        <img src="/assets/OneGapo.png" alt="" className="pwa-install-sheet-logo" />
      </div>
      <div className="pwa-install-sheet-copy">
        <p id="pwa-install-title" className="pwa-install-sheet-title">Install OneGapo</p>
        <p className="pwa-install-sheet-text">Add OneGapo to your home screen for faster access to reports and updates.</p>
      </div>
      <div className="pwa-install-sheet-actions">
        <button type="button" className="btn-outline pwa-install-sheet-dismiss" onClick={hidePrompt}>
          Not now
        </button>
        <button type="button" className="btn-primary pwa-install-sheet-confirm" onClick={installApp}>
          Install
        </button>
      </div>
    </section>
  );
}