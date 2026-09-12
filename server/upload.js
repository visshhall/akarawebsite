// ============================================================================
// UPLOAD SECURITY — every image/video that gets uploaded (product photos,
// return-request photos, anything added later) passes through here before
// it's ever saved or served. Nothing in this file trusts what the browser
// claims about a file (its extension, its declared MIME type) — every check
// re-verifies against the file's actual bytes.
// ============================================================================
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";

const execFileAsync = promisify(execFile);

// Real limits — deliberately conservative. Raise these later with a
// specific reason (e.g. once real 4K product video is a known use case)
// rather than defaulting to "unlimited".
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10MB
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

// Allowlist by real detected type, not by what the client sent. Anything
// not on this list is rejected outright — deliberately narrow rather than
// trying to support every format that exists.
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export class UploadValidationError extends Error {
  constructor(message) { super(message); this.name = "UploadValidationError"; }
}

// Step 1 of every upload: figure out what this file ACTUALLY is by reading
// its real byte signature (magic bytes) — completely ignoring the filename
// and the Content-Type header the browser sent, both of which are trivial
// for anyone to fake (e.g. renaming a disguised file to "photo.jpg").
async function detectRealType(buffer) {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    throw new UploadValidationError("Couldn't verify this file's format — it may be corrupted or not a real image/video.");
  }
  return detected; // { ext, mime }
}

// Strips ALL metadata from an image (EXIF GPS location, device model,
// timestamps, camera serial number, everything) by fully decoding the
// image and re-encoding it from scratch — not just deleting metadata
// fields from the original file. A full re-encode is the stronger
// guarantee: it also can't carry forward anything hidden in the original
// file structure the way a "strip these specific tags" approach could
// miss. Output is always re-encoded as JPEG or PNG/WebP matching input,
// at a sane quality — also naturally caps runaway file dimensions.
async function stripImageMetadata(buffer, mime) {
  const image = sharp(buffer, { failOn: "error" }).rotate(); // .rotate() with no args auto-orients using EXIF orientation BEFORE that data is stripped, so re-encoded images don't end up sideways
  const MAX_DIMENSION = 4000; // sanity cap — no legitimate product photo needs to be larger
  const resized = image.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true });
  if (mime === "image/png") return { buffer: await resized.png({ compressionLevel: 8 }).toBuffer(), mime: "image/png", ext: "png" };
  if (mime === "image/webp") return { buffer: await resized.webp({ quality: 90 }).toBuffer(), mime: "image/webp", ext: "webp" };
  return { buffer: await resized.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: "image/jpeg", ext: "jpg" };
}

// Strips metadata from a video (GPS location, device info, creation
// timestamps, encoder details) via ffmpeg's -map_metadata -1. Unlike the
// image path, this does NOT re-encode the actual video/audio streams
// (-c copy) — full video re-encoding is expensive and slow, and stripping
// the metadata atoms is sufficient for the privacy/security goal here
// (removing identifying info), even though it doesn't rebuild the stream
// data itself the way the image path does.
// Maps a real detected file extension to its correct MIME type for the
// three container formats we accept. Used after stripping so the output
// is labeled correctly — a .mov file must stay labeled video/quicktime,
// not get silently relabeled as video/mp4 just because it isn't webm.
const VIDEO_EXT_TO_MIME = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

async function stripVideoMetadata(buffer, ext) {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `akara-upload-in-${crypto.randomUUID()}.${ext}`);
  const outputPath = path.join(tmpDir, `akara-upload-out-${crypto.randomUUID()}.${ext}`);
  try {
    await writeFile(inputPath, buffer);
    await execFileAsync(ffmpegPath.path, [
      "-i", inputPath,
      "-map_metadata", "-1",   // strip all metadata (GPS, device, timestamps, etc.)
      "-c", "copy",             // don't re-encode streams — fast, lossless
      "-y",                     // overwrite output without prompting
      outputPath,
    ]);
    const cleaned = await readFile(outputPath);
    return { buffer: cleaned, mime: VIDEO_EXT_TO_MIME[ext] || "video/mp4", ext };
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// The full pipeline every uploaded file goes through, in order:
// 1. Size check (before doing any expensive processing)
// 2. Real-type detection from actual bytes (not filename/header)
// 3. Type allowlist check
// 4. Metadata stripping (full re-encode for images, metadata-only strip for video)
// Returns the cleaned buffer + a safe filename to save it as. Throws
// UploadValidationError with a message safe to show the user for anything
// that fails validation.
export async function processUpload(buffer, declaredKind) {
  const isImageDeclared = declaredKind === "image";
  const maxBytes = isImageDeclared ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (buffer.length > maxBytes) {
    throw new UploadValidationError(`File is too large — max ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  }

  const real = await detectRealType(buffer);

  if (ALLOWED_IMAGE_MIME.has(real.mime)) {
    const cleaned = await stripImageMetadata(buffer, real.mime);
    return { ...cleaned, kind: "image", filename: `${crypto.randomUUID()}.${cleaned.ext}` };
  }
  if (ALLOWED_VIDEO_MIME.has(real.mime)) {
    if (buffer.length > MAX_VIDEO_BYTES) {
      throw new UploadValidationError(`Video is too large — max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB.`);
    }
    const cleaned = await stripVideoMetadata(buffer, real.ext);
    return { ...cleaned, kind: "video", filename: `${crypto.randomUUID()}.${cleaned.ext}` };
  }

  throw new UploadValidationError(
    `"${real.mime}" isn't an accepted file type. Accepted: JPEG, PNG, WebP images; MP4, WebM, MOV videos.`
  );
}

export async function ensureUploadDir(dir) {
  await mkdir(dir, { recursive: true });
}
