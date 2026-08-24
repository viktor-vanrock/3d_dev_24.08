#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const versionFile = path.join(root, "version.json");

function read() {
  return JSON.parse(readFileSync(versionFile, "utf8"));
}

function format(v) {
  return `${v.year}.${v.release}.${v.minor}`;
}

const command = process.argv[2];
const v = read();

// peek — узнать следующую версию, НЕ записывая version.json (релиз-runbook Git: знать
// номер v26.<rel+1>.1 до нарезки, чтобы вписать в CHANGELOG). Файл не мутируется.
if (command === "peek") {
  const what = process.argv[3] || "bump";
  const p = read();
  if (what === "release") {
    p.year = new Date().getFullYear() % 100;
    p.release += 1;
    p.minor = 1;
  } else {
    p.minor += 1;
  }
  console.log(format(p));
  process.exit(0);
}

switch (command) {
  case "bump":
    v.minor += 1;
    break;
  case "release":
    v.year = new Date().getFullYear() % 100;
    v.release += 1;
    v.minor = 1;
    break;
  default:
    console.error("Usage: node scripts/version.mjs <bump|release|peek [release]>");
    process.exit(1);
}

writeFileSync(versionFile, JSON.stringify(v, null, 2) + "\n");

const next = format(v);
console.log(next);

// act_runner (GitVerse Actions) сохраняет совместимость с GitHub Actions —
// пишем в GITHUB_OUTPUT, если раннер его выставляет (см. versioning.md § «Допущения»).
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`, { flag: "a" });
}
