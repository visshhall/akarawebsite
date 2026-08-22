import { Router } from "express";
import multer from "multer";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../auth.js";
import { asyncHandler } from "../asyncHandler.js";
import { processUpload, ensureUploadDir, UploadValidationError, MAX_VIDEO_BYTES } from "../upload.js";
import { r2Configured, uploadToR2 } from "../r2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname here is server/routes — needs TWO levels up to reach the
// project root, not one. (Caught by an actual upload test: the API
// reported success, but the file was silently landing in server/uploads
// instead of the project-root uploads/ that server.js actually serves
// from — a real bug, not just a theoretical one.)
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

let warnedNoR2 = false;

// multer with memory storage — the file never touches disk in its
// original, unvalidated form. processUpload() only writes anything to
// disk (briefly, for ffmpeg) or to UPLOAD_DIR after it's already been
// verified and cleaned.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } });

const router = Router();

// Requires login — this endpoint isn't meant to be public. Once the admin
// panel exists, this is what its media upload screen calls; for now it's
// also what a logged-in customer's return-request photo upload would use.
router.post("/", requireAuth, upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file was uploaded." });
  const kind = req.body?.kind === "video" ? "video" : "image";

  let result;
  try {
    result = await processUpload(req.file.buffer, kind);
  } catch (err) {
    if (err instanceof UploadValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  // Real, permanent storage (Cloudflare R2) when configured — this is
  // now the actual production path. Falls back to Railway's own local
  // disk only when R2 credentials are genuinely absent (e.g. local
  // development without them set), and says so loudly rather than
  // silently reintroducing the exact ephemeral-storage problem this
  // was built to fix.
  let url;
  if (r2Configured()) {
    url = await uploadToR2(result.buffer, result.filename, result.mime);
  } else {
    if (!warnedNoR2) {
      console.warn("[upload] R2 is not configured — falling back to local disk, which Railway does NOT persist across redeploys. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_URL to fix this.");
      warnedNoR2 = true;
    }
    await ensureUploadDir(UPLOAD_DIR);
    await writeFile(path.join(UPLOAD_DIR, result.filename), result.buffer);
    url = `/uploads/${result.filename}`;
  }

  res.status(201).json({ url, kind: result.kind, mime: result.mime });
}));

export default router;
