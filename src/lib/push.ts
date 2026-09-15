/**
 * Web Push.
 *
 * On iOS this only works once the PWA is installed from Safari via Share ->
 * Add to Home Screen; it does nothing in a normal tab, and every push must be
 * user-visible because silent pushes get the subscription revoked. The
 * onboarding screen exists for exactly that reason.
 */

import webpush from "web-push";
import { db } from "../db/index";
import { pushSubscriptions } from "../db/schema";
import { eq } from "drizzle-orm";

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:nobody@example.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

/** Sends to every subscription, pruning ones the browser has expired. */
export async function sendPush(message: PushMessage): Promise<{ sent: number; pruned: number }> {
  if (!configure()) return { sent: 0, pruned: 0 };

  const subs = await db.select().from(pushSubscriptions);
  const payload = JSON.stringify(message);
  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
        pruned++;
      }
    }
  }

  return { sent, pruned };
}
