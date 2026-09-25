import fs from "node:fs/promises";
import path from "node:path";

import {
  downloadBinary
} from "./eum_source_client.js";

import {
  loadConfig
} from "./config.js";

function safeFileName(value) {
  const cleaned = String(value ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "attachment";
}

function extensionForKind(kind) {
  if (kind === "pdf") return ".pdf";
  if (kind === "zip") return ".zip";
  if (kind === "hwp") return ".hwp";
  if (kind === "hwpx") return ".hwpx";
  if (kind === "image") return ".img";
  return ".bin";
}

function extensionFromContentType(contentType) {
  const value = String(contentType ?? "").toLowerCase();
  if (value.includes("pdf")) return ".pdf";
  if (value.includes("jpeg")) return ".jpg";
  if (value.includes("png")) return ".png";
  if (value.includes("zip")) return ".zip";
  return "";
}

function extensionFromMagic(magic) {
  if (magic === "pdf") return ".pdf";
  if (magic === "zip") return ".zip";
  if (magic === "jpeg") return ".jpg";
  if (magic === "png") return ".png";
  return "";
}

function detectMagic(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString() === "%PDF") return "pdf";
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) return "zip";
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "png";
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString("hex") === "ffd8ff") return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1"
  ) {
    return "ole";
  }
  return "unknown";
}

function resolveExtension(magic, contentType, kind) {
  return extensionFromMagic(magic) || extensionFromContentType(contentType) || extensionForKind(kind);
}

function expectedTypeFromAttachment(attachment) {
  const combined =
    `${attachment?.displayName ?? ""} ${attachment?.url ?? ""}`
      .toLowerCase();

  if (/\.pdf(?:[?#]|$)|\bpdf\b/i.test(combined)) return "pdf";
  if (/\.zip(?:[?#]|$)|\bzip\b/i.test(combined)) return "zip";
  if (/\.hwpx(?:[?#]|$)|\bhwpx\b/i.test(combined)) return "hwpx";
  if (/\.hwp(?:[?#]|$)|\bhwp\b/i.test(combined)) return "hwp";
  if (/\.(?:jpe?g|png|gif|bmp|webp)(?:[?#]|$)/i.test(combined)) return "image";
  return attachment?.kind || "other";
}

function validateDownloadedBody(attachment, result, magic) {
  const expected = expectedTypeFromAttachment(attachment);
  const contentType = String(result?.contentType ?? "").toLowerCase();

  if (magic !== "unknown") {
    if (expected === "pdf" && magic !== "pdf") {
      throw new Error(
        `Attachment type mismatch: expected PDF, received ${magic}.`
      );
    }
    if (expected === "zip" && magic !== "zip") {
      throw new Error(
        `Attachment type mismatch: expected ZIP, received ${magic}.`
      );
    }
    if (expected === "hwp" && magic !== "ole") {
      throw new Error(
        `Attachment type mismatch: expected HWP/OLE, received ${magic}.`
      );
    }
    if (expected === "hwpx" && magic !== "zip") {
      throw new Error(
        `Attachment type mismatch: expected HWPX/ZIP, received ${magic}.`
      );
    }
    return;
  }

  const looksLikeHtml =
    contentType.includes("text/html") ||
    contentType.includes("text/plain");

  if (looksLikeHtml || result.body.length < 256) {
    const preview =
      result.body.subarray(0, 256).toString("utf8")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    throw new Error(
      `Attachment body does not look like the requested binary file (expected=${expected}, bytes=${result.body.length}, contentType=${result.contentType || "unknown"}, preview=${preview.slice(0, 160)}).`
    );
  }
}

async function findExistingFile(noticeDir, index, displayName) {
  const prefix = String(index + 1).padStart(3, "0") + "_";
  const expected = prefix + displayName;
  try {
    const entries = await fs.readdir(noticeDir);
    if (entries.includes(expected)) return path.join(noticeDir, expected);
    const match = entries.find((name) => name.startsWith(prefix));
    return match ? path.join(noticeDir, match) : null;
  } catch {
    return null;
  }
}

export async function storeAttachment(noticeCode, attachment, index, { force = false } = {}) {
  const downloadRoot = loadConfig().downloadRoot;
  const noticeDir = path.join(downloadRoot, "notice", safeFileName(noticeCode));
  await fs.mkdir(noticeDir, { recursive: true });

  let displayName = safeFileName(
    attachment.displayName
      ?.replace(/&nbsp;/gi, " ")
      .replace(/\s*\([^)]*KByte\)\s*$/i, "")
  );

  if (!displayName) displayName = "attachment_" + (index + 1);

  const existing = !force
    ? await findExistingFile(noticeDir, index, displayName)
    : null;

  const internalRequest =
    attachment?._download || null;

  const publicAttachment = {
    ...attachment
  };

  delete publicAttachment._download;

  if (existing) {
    const stat = await fs.stat(existing);
    return {
      ...publicAttachment,
      filePath: existing,
      downloaded: false,
      cached: true,
      bytes: stat.size
    };
  }

  const result =
    await downloadBinary(
      attachment.url,
      {
        method:
          internalRequest?.method ||
          "GET",

        headers:
          internalRequest?.headers ||
          {},

        body:
          internalRequest?.body ||
          null,

        referer:
          internalRequest?.headers?.Referer ||
          attachment.url
      }
    );

  const magic = detectMagic(result.body);
  validateDownloadedBody(attachment, result, magic);
  const extension = resolveExtension(magic, result.contentType, attachment.kind);

  if (!path.extname(displayName)) displayName += extension;

  const fileName = String(index + 1).padStart(3, "0") + "_" + displayName;
  const filePath = path.join(noticeDir, fileName);
  await fs.writeFile(filePath, result.body);

  return {
    ...publicAttachment,
    filePath,
    downloaded: true,
    cached: false,
    bytes: result.body.length,
    contentType: result.contentType,
    contentLength: result.contentLength,
    contentDisposition: result.contentDisposition,
    magic,
    actualType: magic !== "unknown" ? magic : attachment.kind
  };
}

export async function storeAllAttachments(noticeCode, attachments, options = {}) {
  const result = [];
  for (let i = 0; i < attachments.length; i += 1) {
    result.push(await storeAttachment(noticeCode, attachments[i], i, options));
  }
  return result;
}