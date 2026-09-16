/**
 * Shrink a photograph before it is uploaded.
 *
 * A phone camera produces several megabytes that the model does not need: it
 * reads a worksheet just as well at 1400px, and the difference is the gap
 * between an upload that finishes on school wifi and one that does not.
 */

import { JPEG_QUALITY, MAX_IMAGE_EDGE } from "./attachments";

export interface Downscaled {
  base64: string;
  mediaType: "image/jpeg";
}

export async function downscale(file: Blob): Promise<Downscaled> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return {
    base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1] ?? "",
    mediaType: "image/jpeg",
  };
}

/** Base64 of a file left as-is, for formats a canvas would destroy. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}
