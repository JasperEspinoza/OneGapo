import { useState } from 'react';

export default function InfoTooltip({ text, label = 'More details' }) {
  const [open, setOpen] = useState(false);

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
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
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
        }}
      >
        i
      </button>

      {open ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            left: 'calc(100% + 0.5rem)',
            top: '50%',
            transform: 'translateY(-50%)',
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: '0.72rem',
            lineHeight: 1.4,
            padding: '0.45rem 0.6rem',
            borderRadius: '0.5rem',
            boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16)',
            zIndex: 20,
            pointerEvents: 'none',
            maxWidth: '16rem',
            whiteSpace: 'normal',
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
