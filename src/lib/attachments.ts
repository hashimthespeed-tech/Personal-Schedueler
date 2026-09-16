/**
 * What a message is allowed to carry.
 *
 * The ceiling is not the model's — Claude takes far larger files than this.
 * It is the host's: a serverless request body caps out around 4.5 MB, and a
 * photo that exceeds it fails as an opaque network error rather than as
 * anything a person could act on. So the limit lives here, is checked on both
 * sides, and is stated in the message when it trips.
 */

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const DOC_TYPES = ["application/pdf"] as const;
export const ACCEPTED: readonly string[] = [...IMAGE_TYPES, ...DOC_TYPES];

export const MAX_FILES = 5;
/** base64 characters, roughly 4/3 of the byte count */
export const MAX_TOTAL_BASE64 = 3_500_000;
export const MAX_PDF_BYTES = 2_500_000;

export function isImage(mediaType: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(mediaType);
}

export function isAccepted(mediaType: string): boolean {
  return ACCEPTED.includes(mediaType);
}

/** Long edge after downscaling. A worksheet stays readable well below this. */
export const MAX_IMAGE_EDGE = 1400;
export const JPEG_QUALITY = 0.82;

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
