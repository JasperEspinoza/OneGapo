import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (apiBaseUrl && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return nativeFetch(`${normalizedApiBaseUrl}${input}`, init);
    }

    if (input instanceof URL && input.pathname.startsWith('/api/')) {
      return nativeFetch(new URL(`${normalizedApiBaseUrl}${input.pathname}${input.search}`), init);
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
