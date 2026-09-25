import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { EOL } from "node:os";
import { fileURLToPath } from "node:url";

const root =
  resolve(
    dirname(
      fileURLToPath(import.meta.url)
    ),
    ".."
  );

const distDir =
  resolve(
    root,
    "dist"
  );

mkdirSync(
  distDir,
  {
    recursive:
      true
  }
);

const wrapper = [
  'import "../src/server.js";',
  ""
].join(EOL);

writeFileSync(
  resolve(
    distDir,
    "server.js"
  ),
  wrapper,
  "utf8"
);

console.error(
  "dist/server.js updated as a runtime wrapper for src/server.js"
);
