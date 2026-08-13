import { useState } from 'react';

export default function InfoTooltip({ text, label = 'More details' }) {
  const [open, setOpen] = useState(false);

  const closeTooltip = () => setOpen(false);

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
        aria-label={label}
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

      {open ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            left: '50%',
            top: 'calc(100% + 0.5rem)',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: '0.72rem',
            lineHeight: 1.5,
            padding: '0.55rem 0.7rem',
            borderRadius: '0.5rem',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.22)',
            zIndex: 40,
            pointerEvents: 'none',
            width: 'max-content',
            maxWidth: 'min(18rem, 72vw)',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
