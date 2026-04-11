import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function AppModal({ title, titleId, onClose, children, size = 'default' }) {
  const modalClassName = size === 'wide' ? 'app-modal app-modal-wide' : 'app-modal';

  useEffect(() => {
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    
    // Calculate scrollbar width to prevent layout shift
    const scrollbarWidth = window.innerWidth - body.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  return createPortal(
    <div className="app-modal-overlay" onClick={onClose}>
      <div
        className={modalClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-modal-header">
          <h2 id={titleId} className="app-modal-title">{title}</h2>
          <button type="button" onClick={onClose} className="app-modal-close" aria-label="Close dialog">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="app-modal-body">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}