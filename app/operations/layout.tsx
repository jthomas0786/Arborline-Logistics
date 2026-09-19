import type { ReactNode } from "react";
import { requirePageRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import styles from "./sample-ready-alert.module.css";

type SampleReadyRow = {
  id: string;
  company_name: string | null;
  name: string | null;
  match_count: number | string;
  pending_count: number | string;
  ready_at: Date | string | null;
};

function formatRelative(value: Date | string | null) {
  if (!value) return "ready now";
  const ms = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "ready now";
  if (minutes < 60) return `ready ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ready ${hours}h ago`;
  return `ready ${Math.floor(hours / 24)}d ago`;
}

export default async function OperationsLayout({ children }: { children: ReactNode }) {
  await requirePageRole(["STAFF"]);

  const { rows } = await getPool().query<SampleReadyRow>(`
    SELECT
      i.id,
      i.company_name,
      i.name,
      (SELECT count(*)::int FROM connect_free_sample_matches m WHERE m.request_id=i.id AND m.selected=true) AS match_count,
      count(*) OVER()::int AS pending_count,
      COALESCE(i.sample_prepared_at,i.sample_generated_at,i.updated_at,i.created_at) AS ready_at
    FROM connect_pilot_interest i
    JOIN connect_replies r ON r.id=i.reply_id AND r.classification='SAMPLE_REQUESTED'
    WHERE i.request_type='FREE_SAMPLE'
      AND i.reply_id IS NOT NULL
      AND i.sample_status='READY'
      AND i.sample_approved_at IS NULL
      AND i.sample_email_sent_at IS NULL
    ORDER BY COALESCE(i.sample_prepared_at,i.sample_generated_at,i.updated_at,i.created_at) DESC
    LIMIT 1
  `);

  const sample = rows[0] ?? null;
  const pendingCount = Number(sample?.pending_count || 0);
  const matchCount = Number(sample?.match_count || 0);

  return <>
    {children}
    {sample ? <aside className={styles.alert} role="status" aria-live="polite" aria-label="Sample request ready for review">
      <div className={styles.icon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="m15.5 16.5 1.8 1.8 3.2-4"/></svg></div>
      <div className={styles.body}>
        <div className={styles.headingRow}><strong>Sample requested — ready for review</strong><span>{pendingCount} READY</span></div>
        <p>{sample.company_name || "Outreach prospect"}{sample.name ? ` · ${sample.name}` : ""}</p>
        <small>{matchCount} selected match{matchCount === 1 ? "" : "es"} prepared · {formatRelative(sample.ready_at)}{pendingCount > 1 ? ` · +${pendingCount - 1} more waiting` : ""}</small>
        <div className={styles.actions}><a className={styles.primary} href={`/growth/samples/${sample.id}`}>Review sample <span>→</span></a>{pendingCount > 1 ? <a className={styles.secondary} href="/growth/samples">View all</a> : null}</div>
      </div>
    </aside> : null}
  </>;
}
