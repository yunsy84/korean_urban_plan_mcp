import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT =
  path.resolve(
    path.dirname(
      fileURLToPath(import.meta.url)
    ),
    ".."
  );

test("dist/server.js is a runtime wrapper for the current source server", async () => {
  const content = await readFile(
    path.join(ROOT, "dist", "server.js"),
    "utf8"
  );

  assert.equal(
    content,
    'import "../src/server.js";\n'
  );
});
