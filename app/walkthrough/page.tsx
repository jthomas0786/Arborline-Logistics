import { connectWalkthroughVideoAvailable, getConnectWalkthroughVideoUrl } from "@/lib/connect-walkthrough-video";

export const dynamic = "force-dynamic";

export default async function WalkthroughPage() {
  const videoUrl = getConnectWalkthroughVideoUrl();
  const available = await connectWalkthroughVideoAvailable();

  return <main style={{minHeight:"100vh",background:"radial-gradient(circle at top right,#0d4aa8 0,#071326 34%,#030914 100%)",color:"white",fontFamily:"Inter,system-ui,sans-serif",padding:"40px 20px"}}>
    <div style={{maxWidth:1040,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:30}}>
        <img src="/icon.svg" alt="ArborLine Connect" width={54} height={54} />
        <div><div style={{fontSize:26,fontWeight:800,lineHeight:1}}>ArborLine</div><div style={{fontSize:13,letterSpacing:5,color:"#39c9ff",marginTop:7}}>CONNECT</div></div>
      </div>

      <section style={{background:"rgba(8,25,55,.82)",border:"1px solid rgba(80,170,255,.22)",borderRadius:22,padding:"clamp(22px,4vw,44px)",boxShadow:"0 30px 80px rgba(0,0,0,.35)"}}>
        <p style={{margin:"0 0 10px",fontSize:13,fontWeight:800,letterSpacing:2.2,color:"#40c9ff"}}>90-SECOND WALKTHROUGH</p>
        <h1 style={{fontSize:"clamp(34px,5vw,62px)",lineHeight:1.03,margin:"0 0 16px",maxWidth:850}}>See how ArborLine builds a more qualified B2B pipeline.</h1>
        <p style={{fontSize:"clamp(17px,2vw,21px)",lineHeight:1.6,color:"#c8d7ea",maxWidth:820,margin:"0 0 28px"}}>A quick look at how ArborLine finds matching businesses, identifies decision-makers, qualifies opportunities, and keeps interested replies organized for recurring-service companies.</p>

        {available && videoUrl ? <div style={{overflow:"hidden",borderRadius:16,border:"1px solid rgba(86,183,255,.28)",background:"#020817"}}><video controls playsInline preload="metadata" style={{display:"block",width:"100%",aspectRatio:"16 / 9",background:"#020817"}} src={videoUrl} /></div> : <div style={{padding:"42px 24px",borderRadius:16,border:"1px dashed rgba(120,190,255,.35)",background:"rgba(2,8,23,.65)",textAlign:"center"}}><strong style={{fontSize:20}}>Walkthrough is being prepared.</strong><p style={{color:"#aebfd4",marginBottom:0}}>Please reply to the email and we’ll send it as soon as it is available.</p></div>}

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:22}}>
          {["Find matching businesses","Identify decision-makers","Qualify before outreach","Keep replies organized"].map((item,index)=><div key={item} style={{padding:"16px 18px",borderRadius:14,background:"rgba(21,71,139,.24)",border:"1px solid rgba(76,160,255,.18)"}}><span style={{display:"block",fontSize:12,color:"#40c9ff",fontWeight:800,marginBottom:6}}>0{index+1}</span><strong>{item}</strong></div>)}
        </div>

        <div style={{marginTop:28,paddingTop:22,borderTop:"1px solid rgba(255,255,255,.1)",display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          <div><strong>Founding Client — $750/month</strong><div style={{color:"#aebfd4",fontSize:14,marginTop:4}}>$0 setup fee · month-to-month</div></div>
          <div style={{color:"#c8d7ea",fontSize:15}}>Questions? Just reply to the email. No meeting required.</div>
        </div>
      </section>
    </div>
  </main>;
}
