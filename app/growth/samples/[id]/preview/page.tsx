import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

function externalUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 5) : [];
}

export default async function FreeSamplePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole(["STAFF"]);
  const { id } = await params;
  const pool = getPool();
  const [requestResult, matchesResult] = await Promise.all([
    pool.query(`SELECT id,company_name,industry,service_area,target_customer,decision_maker_titles,sample_provider,sample_generated_at
      FROM connect_pilot_interest WHERE id=$1 AND request_type='FREE_SAMPLE' LIMIT 1`, [id]),
    pool.query(`SELECT rank,company_name,website,domain,industry,city,state,country,employee_count,source,source_url,match_score,match_reasons
      FROM connect_free_sample_matches WHERE request_id=$1 AND selected=true ORDER BY rank`, [id])
  ]);
  const request = requestResult.rows[0];
  if (!request) notFound();

  return <main style={{minHeight:"100vh",background:"#f4f7fb",color:"#101828",padding:"32px 18px"}}>
    <style>{`@media print{.sample-controls{display:none!important}body{background:#fff!important}.sample-sheet{box-shadow:none!important;border:none!important;margin:0!important;max-width:none!important}}`}</style>
    <section className="sample-sheet" style={{maxWidth:920,margin:"0 auto",background:"white",border:"1px solid #dbe4ef",borderRadius:20,boxShadow:"0 22px 70px rgba(15,23,42,.12)",overflow:"hidden"}}>
      <div style={{padding:"30px 34px",background:"linear-gradient(135deg,#071326,#0d2447)",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between",gap:24,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}><img src="/brand/arborline-connect-mark.svg" alt="" width={58} height={50}/><div><div style={{fontSize:22,fontWeight:900}}>Arbor<span style={{color:"#2d7fff"}}>Line</span> Connect</div><div style={{fontSize:12,color:"#9eb7d5",marginTop:4}}>Free Prospect Sample</div></div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#8fb0d3",textTransform:"uppercase",letterSpacing:".14em"}}>Prepared for</div><div style={{fontSize:18,fontWeight:800}}>{request.company_name}</div></div>
      </div>

      <div style={{padding:"34px"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div style={{maxWidth:660}}><p style={{margin:"0 0 8px",fontSize:11,fontWeight:900,letterSpacing:".15em",color:"#2d7fff"}}>YOUR TARGET PROFILE</p><h1 style={{margin:"0 0 12px",fontSize:34,lineHeight:1.05}}>A sample of companies that match who you want to reach.</h1><p style={{margin:0,color:"#53657a",lineHeight:1.65}}>This sample is based on the targeting information you submitted. ArborLine Connect uses that profile to identify businesses worth reviewing before any outreach is considered.</p></div>
          <div className="sample-controls"><PrintButton/></div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,marginTop:26}}>
          <div style={{padding:16,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}><small style={{color:"#667085",fontWeight:800}}>Ideal customer</small><div style={{marginTop:7,fontWeight:750}}>{request.target_customer || "Not specified"}</div></div>
          <div style={{padding:16,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}><small style={{color:"#667085",fontWeight:800}}>Service area</small><div style={{marginTop:7,fontWeight:750}}>{request.service_area || "Not specified"}</div></div>
          <div style={{padding:16,border:"1px solid #e2e8f0",borderRadius:12,background:"#f8fafc"}}><small style={{color:"#667085",fontWeight:800}}>Decision makers</small><div style={{marginTop:7,fontWeight:750}}>{request.decision_maker_titles || "Not specified"}</div></div>
        </div>

        <div style={{marginTop:32}}>
          <p style={{margin:"0 0 8px",fontSize:11,fontWeight:900,letterSpacing:".15em",color:"#2d7fff"}}>SAMPLE MATCHES</p>
          <h2 style={{margin:"0 0 18px",fontSize:26}}>{matchesResult.rows.length} companies selected for review</h2>
          {matchesResult.rows.length === 0 ? <p style={{color:"#667085"}}>No companies are currently selected for this sample.</p> : <div style={{display:"grid",gap:12}}>{matchesResult.rows.map((match) => {
            const url = externalUrl(match.website || match.domain || match.source_url);
            return <article key={`${match.rank}-${match.company_name}`} style={{border:"1px solid #dbe4ef",borderRadius:14,padding:18,display:"grid",gridTemplateColumns:"70px 1fr",gap:16,alignItems:"start"}}>
              <div style={{width:58,height:58,borderRadius:14,background:"#eef5ff",display:"grid",placeItems:"center",fontSize:18,fontWeight:900,color:"#2d7fff"}}>#{match.rank}</div>
              <div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><h3 style={{margin:0,fontSize:19}}>{match.company_name}</h3><span style={{padding:"6px 9px",borderRadius:999,background:Number(match.match_score)>=70?"#ecfdf3":"#fff7ed",color:Number(match.match_score)>=70?"#027a48":"#b54708",fontWeight:900,fontSize:12}}>Match {match.match_score}/100</span></div>
                <p style={{margin:"7px 0 9px",color:"#53657a"}}>{[match.industry,match.city,match.state,match.employee_count ? `${match.employee_count} employees` : null].filter(Boolean).join(" · ") || "Company details limited"}</p>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{reasons(match.match_reasons).map((reason) => <span key={reason} style={{padding:"5px 8px",borderRadius:8,background:"#f8fafc",border:"1px solid #e2e8f0",fontSize:11,color:"#53657a"}}>{reason}</span>)}</div>
                {url ? <p style={{margin:"10px 0 0"}}><a href={url} target="_blank" rel="noreferrer" style={{color:"#2d7fff",fontWeight:800,textDecoration:"none"}}>Review company website →</a></p> : null}
              </div>
            </article>;
          })}</div>}
        </div>

        <div style={{marginTop:30,paddingTop:20,borderTop:"1px solid #e2e8f0",color:"#667085",fontSize:11,lineHeight:1.6}}>This is a prospecting sample, not a guarantee of fit, availability, response, or sale. ArborLine Connect reviews targeting data before outreach and keeps sample generation separate from live campaigns.</div>
      </div>
    </section>
  </main>;
}
