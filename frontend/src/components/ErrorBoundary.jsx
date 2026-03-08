import { Component } from 'react';

/**
 * Catches errors thrown during rendering (e.g. missing Firebase config)
 * and shows a readable message instead of a blank white screen.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-center">
          <div className="error-boundary-box">
            <h1 className="error-boundary-title">Application Error</h1>
            <pre className="error-boundary-message">{this.state.error.message}</pre>
            <p className="error-boundary-hint">
              Check <code>frontend/.env.local</code> and make sure all{' '}
              <code>VITE_FIREBASE_*</code> variables are filled in, then restart the dev server.
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
