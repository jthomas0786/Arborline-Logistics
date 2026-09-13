type BrandLogoProps = {
  context?: string;
  href?: string;
  className?: string;
  compact?: boolean;
};

export function BrandLogo({ context, href, className = "", compact = false }: BrandLogoProps) {
  const content = <>
    <div className={`brandIdentityLockup${compact ? " compact" : ""}`}>
      <img className="brandIdentityLogo" src="/icon.svg" alt="" width={256} height={256}/>
      <span className="brandIdentityName">Arbor<span>Line</span> <b>Connect</b></span>
    </div>
    {context ? <small className="brandIdentityContext">{context}</small> : null}
  </>;

  const classes = `brandIdentity${className ? ` ${className}` : ""}`;
  return href ? <a className={classes} href={href} aria-label="ArborLine Connect">{content}</a> : <div className={classes}>{content}</div>;
}
