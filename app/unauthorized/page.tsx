export default function UnauthorizedPage() {
  return <main className="carrierOfferShell"><section className="carrierOfferCard"><div className="carrierBrand"><span className="mark">A</span><div><strong>ARBORLINE</strong><small>LOGISTICS</small></div></div><p className="eyebrow">ACCESS CONTROL</p><h1>Access restricted</h1><p className="muted">Your account is signed in, but it does not have permission to open this area.</p><form action="/auth/signout" method="post"><button type="submit">Sign out</button></form></section></main>;
}
