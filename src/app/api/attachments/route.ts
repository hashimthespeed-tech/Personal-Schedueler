import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { attachments } from "@/db/schema";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * One attached file, served as bytes.
 *
 * Separate from the thread so that opening a conversation does not ship every
 * photograph in it as base64 inside a JSON payload. An <img> points here, the
 * browser caches it, and scrolling back through a long chat stays cheap.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return new Response("Unauthorized", { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return new Response("Bad request", { status: 400 });

  const file = (await db.select().from(attachments).where(eq(attachments.id, id)).limit(1))[0];
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(file.data, "base64"), {
    headers: {
      "content-type": file.mediaType,
      "content-disposition": `inline; filename="${file.name.replace(/"/g, "")}"`,
      // the bytes never change once written, and this is a private route
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
