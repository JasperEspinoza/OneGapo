import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { getApiBaseUrl, resolveApiUrl } from './config/runtime';
import './index.css';

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

registerSW({
  onRegisterError(error) {
    console.error('Service worker registration failed:', error);
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
