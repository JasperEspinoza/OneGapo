export default function OneGapoLogo({ className = '', alt = 'OneGapo logo', decorative = false }) {
  const rootClass = ['onegapo-logo', className].filter(Boolean).join(' ');

  return (
    <span
      className={rootClass}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : alt}
    >
      <img
        src="/assets/OneGapoDM.png"
        alt=""
        aria-hidden="true"
        className="onegapo-logo-img onegapo-logo-light"
      />
      <img
        src="/assets/OneGapoLogo.png"
        alt=""
        aria-hidden="true"
        className="onegapo-logo-img onegapo-logo-dark"
      />
    </span>
  );
}
