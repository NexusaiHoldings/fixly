import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { buildDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildStripeClient(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
    apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  if (!webhookSecret) {
    console.error(JSON.stringify({ event: "stripe_webhook_config_error", message: "STRIPE_WEBHOOK_SECRET not set" }));
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  const stripe = buildStripeClient();
  let stripeEvent: Stripe.Event;

  try {
    stripeEvent = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signature verification failed";
    console.error(JSON.stringify({ event: "stripe_webhook_sig_error", message }));
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const db = buildDb();

  try {
    switch (stripeEvent.type) {
      case "transfer.created":
      case "transfer.paid": {
        const transfer = stripeEvent.data.object as Stripe.Transfer;
        const jobId = transfer.metadata?.job_id;
        const tradespersonId = transfer.metadata?.tradesperson_id;
        const payoutAmount = transfer.amount / 100;
        const isPaid = stripeEvent.type === "transfer.paid";

        if (jobId && tradespersonId) {
          await db.execute(
            `UPDATE dispatch_jobs
             SET payout_amount   = $1,
                 stripe_transfer_id = $2,
                 updated_at       = NOW()
             WHERE id = $3::uuid
               AND tradesperson_id = $4::uuid`,
            payoutAmount,
            transfer.id,
            jobId,
            tradespersonId,
          );

          if (isPaid) {
            await db.execute(
              `UPDATE dispatch_jobs
               SET status     = 'paid',
                   updated_at = NOW()
               WHERE id = $1::uuid
                 AND tradesperson_id = $2::uuid
                 AND status = 'completed'`,
              jobId,
              tradespersonId,
            );
          }
        }

        console.info(JSON.stringify({
          event: "stripe_transfer_processed",
          type: stripeEvent.type,
          transfer_id: transfer.id,
          job_id: jobId ?? null,
          amount: payoutAmount,
        }));
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(JSON.stringify({
      event: "stripe_webhook_processing_error",
      type: stripeEvent.type,
      message,
    }));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
