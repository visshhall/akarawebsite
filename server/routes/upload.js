import { Router } from "express";
import multer from "multer";
import { writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../auth.js";
import { asyncHandler } from "../asyncHandler.js";
import { processUpload, ensureUploadDir, UploadValidationError, MAX_VIDEO_BYTES } from "../upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname here is server/routes — needs TWO levels up to reach the
// project root, not one. (Caught by an actual upload test: the API
// reported success, but the file was silently landing in server/uploads
// instead of the project-root uploads/ that server.js actually serves
// from — a real bug, not just a theoretical one.)
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

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

  await ensureUploadDir(UPLOAD_DIR);
  await writeFile(path.join(UPLOAD_DIR, result.filename), result.buffer);

  // NOTE: this saves to local disk, which works for local dev and for
  // Railway short-term, but Railway's filesystem is NOT persistent across
  // redeploys — an uploaded file would vanish the next time the service
  // rebuilds. Before this goes live for real product photos, this should
  // write to real object storage (e.g. an S3-compatible bucket) instead
  // of the local `uploads/` folder. Flagged clearly rather than silently
  // shipped as if it were production-ready as-is.
  res.status(201).json({ url: `/uploads/${result.filename}`, kind: result.kind, mime: result.mime });
}));

export default router;