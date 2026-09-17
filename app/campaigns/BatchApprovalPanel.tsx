"use client";

import { useMemo, useState } from "react";
import { stageControlledOutreachBatch } from "./batch-actions";
import styles from "./CampaignBatchControls.module.css";

type BatchRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  contact_title: string | null;
  qualification_score: number | null;
  recipient_email: string;
};

export function BatchApprovalPanel({
  clientId,
  clientName,
  batch
}: {
  clientId: string;
  clientName: string;
  batch: BatchRow[];
}) {
  const [selectedCount, setSelectedCount] = useState(Math.min(batch.length, 5));
  const [confirming, setConfirming] = useState(false);
  const [checked, setChecked] = useState(false);
  const [phrase, setPhrase] = useState("");
  const selected = useMemo(() => batch.slice(0, selectedCount), [batch, selectedCount]);
  const canSubmit = checked && phrase === "APPROVE BATCH" && selected.length > 0;

  function resetConfirmation() {
    setConfirming(false);
    setChecked(false);
    setPhrase("");
  }

  return (
    <div className={styles.batchWrap}>
      <div className={styles.batchHeader}>
        <div>
          <span>Reviewed batch</span>
          <strong>{clientName}</strong>
        </div>
        <label className={styles.countControl}>
          Approve
          <select
            value={selectedCount}
            onChange={(event) => {
              setSelectedCount(Number(event.target.value));
              resetConfirmation();
            }}
            aria-label="Number of drafts to approve"
          >
            {Array.from({ length: batch.length }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.candidateList}>
        {selected.map((row, index) => (
          <div className={styles.candidate} key={row.id}>
            <span className={styles.number}>{index + 1}</span>
            <div className={styles.identity}>
              <strong>{row.company_name}</strong>
              <span>{row.contact_name || "Verified decision-maker"}{row.contact_title ? ` · ${row.contact_title}` : ""}</span>
            </div>
            <span className={styles.email}>{row.recipient_email}</span>
            <span className={styles.fit}>FIT {row.qualification_score ?? 0}</span>
          </div>
        ))}
      </div>

      {!confirming ? (
        <div className={styles.actionBar}>
          <div className={styles.actionCopy}>
            <strong>{selected.length} draft{selected.length === 1 ? "" : "s"} selected</strong>
            <span>Approval queues these exact messages. Nothing sends immediately.</span>
          </div>
          <button type="button" className={styles.primaryAction} onClick={() => setConfirming(true)}>
            Review & approve batch
          </button>
        </div>
      ) : (
        <form action={stageControlledOutreachBatch} className={styles.confirmBox} autoComplete="off">
          <input type="hidden" name="clientId" value={clientId} />
          {selected.map((row) => <input key={row.id} type="hidden" name="messageId" value={row.id} />)}

          <div className={styles.confirmTitle}>
            <div>
              <strong>Final approval</strong>
              <span>You are approving these {selected.length} exact drafts for the controlled 9:00 AM Central queue.</span>
            </div>
            <span className={styles.safetyNote}>Exact-draft lock</span>
          </div>

          <div className={styles.confirmGrid}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                name="confirmApproval"
                value="APPROVE"
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                required
              />
              <span>I reviewed this batch and intentionally approve these messages to enter the send queue.</span>
            </label>
            <label className={styles.phraseLabel}>
              Confirmation phrase
              <input
                name="approvalText"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value.toUpperCase())}
                placeholder="APPROVE BATCH"
                required
              />
            </label>
          </div>

          <div className={styles.confirmActions}>
            <button type="button" className="secondary" onClick={resetConfirmation}>Cancel</button>
            <button type="submit" className={styles.confirmButton} disabled={!canSubmit}>
              Approve {selected.length} for 9 AM
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
