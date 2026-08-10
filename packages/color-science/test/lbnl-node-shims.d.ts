/**
 * Minimal Node.js type shims for the LBNL validation test.
 *
 * The workspace intentionally has no @types/node dependency, and this
 * package compiles with `lib: ["ES2022"]` (no DOM), so the few Node
 * globals the file-based validation test needs are declared here.
 * Ambient module declarations must live in a non-module (.d.ts) file —
 * inside a module they are parsed as module *augmentations* of modules
 * that do not resolve (TS2664).
 *
 * If @types/node is ever added to the workspace, delete this file.
 */

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options: { recursive: true }): void;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

interface ImportMeta {
  url: string;
}

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

declare const performance: {
  now(): number;
};
