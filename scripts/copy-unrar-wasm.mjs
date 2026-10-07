import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const source = join(process.cwd(), "node_modules", "node-unrar-js", "esm", "js", "unrar.wasm");
const target = join(process.cwd(), "public", "vendor", "unrar.wasm");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
