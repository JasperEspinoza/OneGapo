import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function AppModal({ title, titleId, onClose, children }) {
  useEffect(() => {
    const { body } = document;
    const previousOverflow = body.style.overflow;

    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div className="app-modal-overlay" onClick={onClose}>
      <div
        className="app-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-modal-header">
          <h2 id={titleId} className="app-modal-title">{title}</h2>
          <button type="button" onClick={onClose} className="app-modal-close" aria-label="Close dialog">X</button>
        </div>
        <div className="app-modal-body">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}