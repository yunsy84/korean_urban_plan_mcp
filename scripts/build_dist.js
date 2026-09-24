import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src", "server.js");
const dist = resolve(root, "dist", "server.js");
mkdirSync(dirname(dist), { recursive: true });
copyFileSync(src, dist);
console.error(`dist/server.js updated from src/server.js`);
