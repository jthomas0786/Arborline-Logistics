type BrandLogoProps = {
  context?: string;
  href?: string;
  className?: string;
  compact?: boolean;
};

export function BrandLogo({ context, href, className = "", compact = false }: BrandLogoProps) {
  const content = <>
    <img
      className={`brandIdentityLogo${compact ? " compact" : ""}`}
      src={compact ? "/brand/arborline-badge.png" : "/brand/arborline-logo.png"}
      alt="ArborLine Logistics"
      width={compact ? 256 : 700}
      height={compact ? 256 : 227}
    />
    {context ? <small className="brandIdentityContext">{context}</small> : null}
  </>;

  const classes = `brandIdentity${className ? ` ${className}` : ""}`;
  return href ? <a className={classes} href={href}>{content}</a> : <div className={classes}>{content}</div>;
}
