import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { replan } from "@/core/replan";
import { runReview } from "@/agents/review";
import { sendPush } from "@/lib/push";
import { today } from "@/agents/context";

// The nightly review is the slowest path in the app: two solver iterations
// around an Opus 5 turn. 300s is what Hobby allows with Fluid compute.
export const maxDuration = 300;

/**
 * Two callers: the Replan button (solver only, instant, free) and the nightly
 * cron (solver plus the Stage B review, which costs an API call).
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const withReview = url.searchParams.get("review") === "1";

  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    request.headers.get("authorization") === `Bearer ${cronSecret}` ||
    (await getSession()).loggedIn === true;

  if (!authorized) return NextResponse.json({ ok: false }, { status: 401 });

  const date = today();

  if (!withReview) {
    const plan = await replan(date);
    return NextResponse.json({
      ok: true,
      blocks: plan.blocks.length,
      unplaced: plan.unplaced.length,
      utilization: plan.utilization,
    });
  }

  const review = await runReview(date);
  await sendPush({
    title: "Tomorrow's plan is ready",
    body: review.summary.slice(0, 160),
    url: "/",
  });

  return NextResponse.json({
    ok: true,
    summary: review.summary,
    changes: review.changes,
    blocks: review.plan.blocks.length,
    unplaced: review.plan.unplaced.length,
  });
}
