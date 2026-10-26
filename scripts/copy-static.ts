import { cpSync, mkdirSync } from "node:fs";
import { extname } from "node:path";

const staticExtensions = new Set([".json", ".html", ".css", ".png", ".svg"]);

mkdirSync("dist", { recursive: true });
cpSync("src", "dist", {
  recursive: true,
  filter: (path) => !extname(path) || staticExtensions.has(extname(path)),
});
