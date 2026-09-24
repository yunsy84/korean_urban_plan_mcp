import fs from "node:fs/promises";
import path from "node:path";

import {
  downloadBinary
} from "./eum_source_client.js";

const ROOT =
  process.cwd();

const CACHE_ROOT =
  path.join(
    ROOT,
    "cache",
    "notice"
  );

function safeFileName(
  value
) {
  const cleaned =
    String(value ?? "")
      .replace(
        /[<>:"/\\|?*\x00-\x1F]/g,
        "_"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return (
    cleaned ||
    "attachment"
  );
}

function extensionForKind(
  kind
) {
  if (kind === "pdf") {
    return ".pdf";
  }

  if (kind === "zip") {
    return ".zip";
  }

  if (kind === "image") {
    return ".img";
  }

  return ".bin";
}

function extensionFromContentType(
  contentType
) {
  const value =
    String(
      contentType ?? ""
    ).toLowerCase();

  if (
    value.includes(
      "pdf"
    )
  ) {
    return ".pdf";
  }

  if (
    value.includes(
      "jpeg"
    )
  ) {
    return ".jpg";
  }

  if (
    value.includes(
      "png"
    )
  ) {
    return ".png";
  }

  if (
    value.includes(
      "zip"
    )
  ) {
    return ".zip";
  }

  return "";
}

function detectMagic(
  buffer
) {
  if (
    buffer.length >= 4 &&
    buffer.subarray(
      0,
      4
    ).toString() ===
      "%PDF"
  ) {
    return "pdf";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  ) {
    return "zip";
  }

  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .toString("hex") ===
      "89504e470d0a1a0a"
  ) {
    return "png";
  }

  if (
    buffer.length >= 3 &&
    buffer
      .subarray(0, 3)
      .toString("hex") ===
      "ffd8ff"
  ) {
    return "jpeg";
  }

  return "unknown";
}

export async function storeAttachment(
  noticeCode,
  attachment,
  index
) {
  const noticeDir =
    path.join(
      CACHE_ROOT,
      safeFileName(
        noticeCode
      )
    );

  await fs.mkdir(
    noticeDir,
    {
      recursive:
        true
    }
  );

  const result =
    await downloadBinary(
      attachment.url
    );

  const magic =
    detectMagic(
      result.body
    );

  let extension =
    extensionFromContentType(
      result.contentType
    );

  if (!extension) {
    extension =
      extensionForKind(
        attachment.kind
      );
  }

  let displayName =
    safeFileName(
      attachment.displayName
        ?.replace(
          /&nbsp;/gi,
          " "
        )
        .replace(
          /\s*\([^)]*KByte\)\s*$/i,
          ""
        )
    );

  if (
    !displayName
  ) {
    displayName =
      `attachment_${index + 1}`;
  }

  if (
    !path
      .extname(
        displayName
      )
  ) {
    displayName +=
      extension;
  }

  const fileName =
    `${String(
      index + 1
    ).padStart(3, "0")}_${displayName}`;

  const filePath =
    path.join(
      noticeDir,
      fileName
    );

  await fs.writeFile(
    filePath,
    result.body
  );

  return {
    ...attachment,

    filePath,

    downloaded:
      true,

    bytes:
      result.body.length,

    contentType:
      result.contentType,

    contentLength:
      result.contentLength,

    contentDisposition:
      result.contentDisposition,

    magic
  };
}

export async function storeAllAttachments(
  noticeCode,
  attachments
) {
  const result = [];

  for (
    let i = 0;
    i < attachments.length;
    i += 1
  ) {
    result.push(
      await storeAttachment(
        noticeCode,
        attachments[i],
        i
      )
    );
  }

  return result;
}