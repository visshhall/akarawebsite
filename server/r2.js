// ============================================================================
// CLOUDFLARE R2 — real, permanent object storage for uploaded product
// photos/videos, replacing Railway's own disk (which isn't persistent —
// a redeploy wipes it, a real gap flagged directly in a security review
// and confirmed by inspecting server/routes/upload.js's original write
// path). R2 speaks the same API as AWS S3, so the official AWS SDK works
// against it directly — just pointed at R2's own endpoint instead of
// AWS's, with R2's own credentials.
//
// Every credential below is read from an environment variable, never
// hardcoded — same pattern as every other third-party credential in this
// app (Razorpay, Resend, Gupshup). Set these on Railway:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET_NAME, R2_PUBLIC_URL
// ============================================================================
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
// The public bucket URL (the pub-xxxx.r2.dev one, or a custom domain
// later) — what actually gets embedded in <img> tags and stored in the
// database. Never the jurisdiction-specific API endpoint below, which is
// only for talking to R2, not for serving files to browsers.
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    return null;
  }
  client = new S3Client({
    region: "auto", // R2 doesn't use AWS regions — "auto" is R2's own documented value
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export function r2Configured() {
  return !!getClient() && !!R2_BUCKET_NAME && !!R2_PUBLIC_URL;
}

// Uploads an already-validated, already-cleaned buffer (the output of
// processUpload() in server/upload.js — this function does no validation
// of its own, it only stores what it's given). Returns the final public
// URL a browser can load directly.
export async function uploadToR2(buffer, filename, contentType) {
  const s3 = getClient();
  if (!s3) throw new Error("R2 is not configured — missing environment variables.");
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: filename,
    Body: buffer,
    ContentType: contentType,
    // A year — product photos essentially never change once uploaded
    // (a genuinely new photo gets a new filename via the existing
    // UUID scheme, not an overwrite), so long-lived caching is safe
    // and meaningfully reduces repeat load time for returning visitors.
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return `${R2_PUBLIC_URL}/${filename}`;
}

export async function deleteFromR2(filename) {
  const s3 = getClient();
  if (!s3) throw new Error("R2 is not configured — missing environment variables.");
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: filename }));
}
