#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const compiled = join(root, "..", "dist", "src", "cli", "index.ts");
const source = join(root, "..", "src", "cli", "index.ts");

const entry = existsSync(compiled) ? compiled : source;
const { main } = await import(entry);
await main(process.argv.slice(2));