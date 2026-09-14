"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} style={{minHeight:44,padding:"0 16px",borderRadius:10,border:"1px solid #2d7fff",background:"#2d7fff",color:"white",fontWeight:800,cursor:"pointer"}}>Print / Save PDF</button>;
}
