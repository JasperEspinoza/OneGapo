import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { getApiBaseUrl, resolveApiUrl } from './config/runtime';
import './index.css';

/* global __PWA_ENABLED__ */

if (typeof __PWA_ENABLED__ === 'undefined') {
  throw new Error('Missing build flag: __PWA_ENABLED__');
}

const apiBaseUrl = getApiBaseUrl();

if (apiBaseUrl && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    if (typeof input === 'string') {
      return nativeFetch(resolveApiUrl(input), init);
    }

    if (input instanceof URL && input.pathname.startsWith('/api/')) {
      return nativeFetch(resolveApiUrl(`${input.pathname}${input.search}`), init);
    }

    if (input instanceof Request) {
      const rewrittenUrl = resolveApiUrl(input.url);
      if (rewrittenUrl !== input.url) {
        const clonedRequest = new Request(rewrittenUrl, input);
        return nativeFetch(clonedRequest, init);
      }
    }

    return nativeFetch(input, init);
  };
}

if (__PWA_ENABLED__) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onRegisterError(error) {
        console.error('Service worker registration failed:', error);
      },
    });
  });
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    })
    .catch(() => {
      // Ignore unregister failures in constrained environments.
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
