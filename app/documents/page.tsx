import { AppShell } from "@/app/components/AppShell";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getDocuments() {
  const { rows } = await getPool().query(
    `SELECT d.id,d.document_type,d.status,d.file_name,d.content_type,d.file_size_bytes,d.sha256,d.uploaded_via,d.uploaded_at,d.validated_at,
            l.reference_number,l.status load_status
     FROM load_documents d
     JOIN loads l ON l.id=d.load_id
     ORDER BY d.uploaded_at DESC
     LIMIT 200`
  );
  return rows;
}

export default async function DocumentsPage() {
  await requirePageRole(["STAFF"]);
  const documents = await getDocuments();
  return <AppShell active="Documents"><header><div><p className="eyebrow">AUDIT PACKAGE</p><h1>Documents</h1><p className="muted">Validated shipment documents retained with their load timeline.</p></div></header><section className="panel"><div className="tableWrap"><table><thead><tr><th>Load</th><th>Type</th><th>Status</th><th>File</th><th>Size</th><th>Uploaded</th><th>Source</th><th>Action</th></tr></thead><tbody>{documents.length === 0 ? <tr><td colSpan={8} className="empty">No documents received yet.</td></tr> : documents.map((document) => <tr key={document.id}><td><strong>{document.reference_number}</strong><br/><span className={`status ${String(document.load_status).toLowerCase()}`}>{document.load_status}</span></td><td>{document.document_type}</td><td><span className="status">{document.status}</span></td><td>{document.file_name}</td><td>{Math.max(1,Math.round(Number(document.file_size_bytes)/1024)).toLocaleString()} KB</td><td>{new Date(document.uploaded_at).toLocaleString()}</td><td>{document.uploaded_via}</td><td><a className="tableLink" href={`/api/documents/${document.id}/download`}>Download</a></td></tr>)}</tbody></table></div></section></AppShell>;
}
