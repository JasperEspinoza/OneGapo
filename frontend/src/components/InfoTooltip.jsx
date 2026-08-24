import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function InfoTooltip({ text, label = 'More details' }) {
  const [open, setOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  const tooltipId = useId();
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  const closeTooltip = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tooltipRef.current) return undefined;

    const updateTooltipPosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      if (!triggerRect || !tooltipRect) return;

      const viewportPadding = 8;
      const gap = 8;
      const preferredLeft = triggerRect.left + ((triggerRect.width - tooltipRect.width) / 2);
      const left = Math.max(
        viewportPadding,
        Math.min(preferredLeft, window.innerWidth - tooltipRect.width - viewportPadding)
      );
      const canFitBelow = triggerRect.bottom + gap + tooltipRect.height <= window.innerHeight - viewportPadding;
      const top = canFitBelow
        ? triggerRect.bottom + gap
        : Math.max(viewportPadding, triggerRect.top - gap - tooltipRect.height);

      setTooltipPosition({ left, top });
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);

    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [open, text]);

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        marginLeft: '0.4rem',
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        title={label}
        onClick={() => setOpen((prev) => !prev)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={closeTooltip}
        onFocus={() => setOpen(true)}
        onBlur={closeTooltip}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            closeTooltip();
          }
        }}
        style={{
          width: '1.15rem',
          height: '1.15rem',
          borderRadius: '999px',
          border: '1px solid #cbd5e1',
          background: '#f8fafc',
          color: '#475569',
          fontSize: '0.7rem',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          flexShrink: 0,
        }}
      >
        i
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <span
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'fixed',
            left: tooltipPosition?.left ?? -10000,
            top: tooltipPosition?.top ?? -10000,
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: '0.72rem',
            lineHeight: 1.5,
            padding: '0.55rem 0.7rem',
            borderRadius: '0.5rem',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.22)',
            zIndex: 2147483647,
            pointerEvents: 'none',
            width: 'max-content',
            maxWidth: 'min(18rem, calc(100vw - 1rem))',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </span>,
        document.body
      ) : null}
    </span>
  );
}
