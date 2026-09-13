import Link from "next/link";
import { AppShell } from "../../components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { connectWalkthroughVideoAvailable, getConnectWalkthroughVideoUrl } from "@/lib/connect-walkthrough-video";
import { WalkthroughUploader } from "./WalkthroughUploader";

export const dynamic = "force-dynamic";

export default async function WalkthroughAdminPage() {
  await requirePageRole(["STAFF"]);
  const videoUrl = getConnectWalkthroughVideoUrl();
  const available = await connectWalkthroughVideoAvailable();

  return <AppShell active="Growth">
    <header>
      <div>
        <p className="eyebrow">ARBORLINE WALKTHROUGH</p>
        <h1>Manage the sales walkthrough</h1>
        <p className="muted">Upload the final customer-facing MP4 here. The public walkthrough page uses this file, so the email automation can keep one stable ArborLine URL.</p>
      </div>
    </header>

    <section className="panel" style={{marginBottom:12}}>
      <div className="panelHead">
        <div><p className="eyebrow">CURRENT VIDEO</p><h3>{available ? "Walkthrough is ready" : "No walkthrough uploaded yet"}</h3></div>
        <span className="status">{available ? "Ready" : "Not ready"}</span>
      </div>
      {available && videoUrl ? <video controls preload="metadata" style={{width:"100%",maxWidth:960,borderRadius:14,background:"#020817"}} src={`${videoUrl}?v=${Date.now()}`} /> : <p className="muted">Upload the approved walkthrough before enabling automatic video fulfillment.</p>}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:12}}>
        <Link className="button" href="/walkthrough" target="_blank">Open public walkthrough</Link>
        <Link className="button" href="/growth">Back to Growth</Link>
      </div>
    </section>

    <section className="panel">
      <div className="panelHead"><div><p className="eyebrow">UPLOAD</p><h3>Replace the walkthrough video</h3></div></div>
      <p className="muted">This uploads directly from your browser to ArborLine's Supabase Storage bucket. It does not pass the video through Vercel, so the normal serverless request-size limit is avoided.</p>
      <WalkthroughUploader />
    </section>
  </AppShell>;
}
