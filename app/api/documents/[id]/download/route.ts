import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole(["STAFF"]);
  if (!auth.identity) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await context.params;
  const { rows } = await getPool().query(
    `SELECT file_name,content_type,content FROM load_documents WHERE id=$1`,
    [id]
  );
  const document = rows[0];
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const body = document.content instanceof Uint8Array ? document.content : new Uint8Array(document.content);
  return new Response(body, {
    headers: {
      "content-type": document.content_type,
      "content-disposition": `attachment; filename="${String(document.file_name).replace(/[\r\n\"]/g, "_")}"`,
      "cache-control": "private, no-store"
    }
  });
}
