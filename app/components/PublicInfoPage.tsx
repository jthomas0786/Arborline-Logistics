import type { ReactNode } from "react";

export default function PublicInfoPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "#071326", color: "#edf4ff", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
    <header style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 28px", display: "flex", gap: 22, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", borderBottom: "1px solid rgba(148,163,184,.16)" }}>
      <a href="/" style={{ color: "#f8fbff", fontWeight: 800, fontSize: 20, textDecoration: "none", letterSpacing: "-.02em" }}>Arbor<span style={{ color: "#52b8ff" }}>Line</span> Connect</a>
      <nav style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14 }}>
        <a href="/sample" style={{ color: "#cbd8e8", textDecoration: "none" }}>Free sample</a>
        <a href="/privacy" style={{ color: "#cbd8e8", textDecoration: "none" }}>Privacy</a>
        <a href="/terms" style={{ color: "#cbd8e8", textDecoration: "none" }}>Terms</a>
        <a href="/data-practices" style={{ color: "#cbd8e8", textDecoration: "none" }}>Data practices</a>
        <a href="/contact" style={{ color: "#cbd8e8", textDecoration: "none" }}>Contact</a>
      </nav>
    </header>

    <article style={{ maxWidth: 860, margin: "0 auto", padding: "72px 28px 96px" }}>
      <p style={{ margin: "0 0 14px", color: "#52b8ff", fontSize: 12, fontWeight: 800, letterSpacing: ".16em" }}>{eyebrow}</p>
      <h1 style={{ margin: 0, maxWidth: 760, fontSize: "clamp(36px, 6vw, 62px)", lineHeight: 1.02, letterSpacing: "-.045em" }}>{title}</h1>
      <p style={{ margin: "24px 0 46px", maxWidth: 740, color: "#b8c8da", fontSize: 18, lineHeight: 1.7 }}>{intro}</p>
      <section style={{ display: "grid", gap: 28, color: "#dbe7f4", fontSize: 16, lineHeight: 1.75 }}>{children}</section>
    </article>

    <footer style={{ maxWidth: 1120, margin: "0 auto", padding: "28px", borderTop: "1px solid rgba(148,163,184,.16)", color: "#8498ad", fontSize: 13 }}>
      ArborLine Connect · Managed customer acquisition for commercial service businesses.
    </footer>
  </main>;
}

export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ padding: "24px 26px", border: "1px solid rgba(148,163,184,.16)", borderRadius: 18, background: "rgba(16,31,52,.64)" }}>
    <h2 style={{ margin: "0 0 10px", fontSize: 21, color: "#f5f9ff" }}>{title}</h2>
    <div style={{ color: "#b8c8da" }}>{children}</div>
  </section>;
}
