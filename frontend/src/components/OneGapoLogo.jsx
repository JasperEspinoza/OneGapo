export default function OneGapoLogo({ className = '', alt = 'OneGapo logo', decorative = false }) {
  const rootClass = ['onegapo-logo', className].filter(Boolean).join(' ');

  return (
    <span className={rootClass} aria-hidden={decorative ? 'true' : undefined}>
      <img
        src="/assets/OneGapoDM.png"
        alt={decorative ? '' : alt}
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
