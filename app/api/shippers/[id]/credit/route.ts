import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { getShipperCreditSnapshot, recordCreditEvent } from "@/lib/shipper-credit";

const allowedStatuses = new Set(["PENDING","APPROVED","PREPAY","HOLD","DECLINED"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole(["STAFF"]);
  if (!access.identity) return NextResponse.json({ error: access.error }, { status: access.status });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const creditStatus = typeof body.creditStatus === "string" ? body.creditStatus.toUpperCase() : "";
  const creditLimit = body.creditLimit === null || body.creditLimit === "" ? null : Number(body.creditLimit);
  const paymentTermsDays = Number(body.paymentTermsDays ?? 30);
  const riskScore = Number(body.riskScore ?? 0);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  if (!allowedStatuses.has(creditStatus)) return NextResponse.json({ error: "Invalid credit status." }, { status: 400 });
  if (creditLimit !== null && (!Number.isFinite(creditLimit) || creditLimit < 0)) return NextResponse.json({ error: "Credit limit must be zero or greater." }, { status: 400 });
  if (creditStatus === "APPROVED" && (creditLimit === null || creditLimit <= 0)) return NextResponse.json({ error: "Approved shippers require a positive credit limit." }, { status: 400 });
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 120) return NextResponse.json({ error: "Payment terms must be between 0 and 120 days." }, { status: 400 });
  if (!Number.isInteger(riskScore) || riskScore < 0 || riskScore > 100) return NextResponse.json({ error: "Risk score must be between 0 and 100." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "A review reason is required for credit changes." }, { status: 400 });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT credit_status,onboarding_status FROM shippers WHERE id=$1 FOR UPDATE`, [id]);
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Shipper not found." }, { status: 404 });
    }
    const before = await getShipperCreditSnapshot(id, client);
    await client.query(
      `UPDATE shippers
       SET credit_status=$2,credit_limit=$3,payment_terms_days=$4,risk_score=$5,credit_reviewed_at=now(),credit_reviewed_by=$6
       WHERE id=$1`,
      [id,creditStatus,creditLimit,paymentTermsDays,riskScore,access.identity.userId]
    );
    await recordCreditEvent(client, {
      shipperId: id,
      eventType: "CREDIT_POLICY_UPDATED",
      previousStatus: locked.rows[0].credit_status,
      newStatus: creditStatus,
      creditLimit,
      exposureBefore: before?.exposure ?? null,
      decision: creditStatus === "APPROVED" ? "APPROVE" : creditStatus,
      reason,
      actorUserId: access.identity.userId,
      metadata: { paymentTermsDays, riskScore }
    });

    let override = null;
    if (body.override && typeof body.override === "object") {
      const maxExposure = Number(body.override.maxExposure);
      const expiresAt = new Date(body.override.expiresAt);
      const overrideReason = typeof body.override.reason === "string" ? body.override.reason.trim().slice(0, 500) : "";
      if (!Number.isFinite(maxExposure) || maxExposure < 0 || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now() || !overrideReason) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Override requires max exposure, a future expiration, and a reason." }, { status: 400 });
      }
      const inserted = await client.query(
        `INSERT INTO shipper_credit_overrides (shipper_id,max_exposure,reason,expires_at,created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id,max_exposure,reason,expires_at`,
        [id,maxExposure,overrideReason,expiresAt.toISOString(),access.identity.userId]
      );
      override = inserted.rows[0];
      await recordCreditEvent(client, {
        shipperId: id,
        eventType: "CREDIT_OVERRIDE_CREATED",
        creditLimit: maxExposure,
        exposureBefore: before?.exposure ?? null,
        decision: "OVERRIDE",
        reason: overrideReason,
        actorUserId: access.identity.userId,
        metadata: { overrideId: override.id, expiresAt: override.expires_at }
      });
    }

    if (typeof body.revokeOverrideId === "string" && body.revokeOverrideId) {
      const revoked = await client.query(
        `UPDATE shipper_credit_overrides SET revoked_at=now(),revoked_by=$3
         WHERE id=$1 AND shipper_id=$2 AND revoked_at IS NULL
         RETURNING id`,
        [body.revokeOverrideId,id,access.identity.userId]
      );
      if (revoked.rows[0]) {
        await recordCreditEvent(client, {
          shipperId: id,
          eventType: "CREDIT_OVERRIDE_REVOKED",
          exposureBefore: before?.exposure ?? null,
          decision: "REVOKE",
          reason,
          actorUserId: access.identity.userId,
          metadata: { overrideId: body.revokeOverrideId }
        });
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, snapshot: await getShipperCreditSnapshot(id), override });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update shipper credit." }, { status: 500 });
  } finally {
    client.release();
  }
}
