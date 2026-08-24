#!/usr/bin/env node
// Автоматически подсыпает заметные коммиты в `## [Unreleased]` секцию changelog.md.
// Вызывается из .gitverse/workflows/release.yaml на каждый push в dev, тем же
// коммитом что и version bump — не отдельным, чтобы не плодить лишний CI-триггер
// (MF-908: ручное "буду держать тёплым" от роли Git не исполнялось 5+ проходов подряд).
//
// Диапазон: от предыдущего `chore(release):`-коммита (эксклюзивно) до HEAD (текущий
// push, до бампа версии). Дедуп — по MF-ссылке или точному тексту пункта, уже
// присутствующему в файле, чтобы не задваивать записи, вписанные вручную автором PR.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const changelogFile = path.join(root, "changelog.md");

const SEP = "\x1e", FS = "\x1f";
const skip = /^(chore\(release\)|Merge |sync main)/i;
const conv = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const mfRe = /MF-\d+/g;

function lastReleaseCommit() {
  // CHANGELOG_UNRELEASED_BASE — ручной override для отладки/тестов вне CI.
  if (process.env.CHANGELOG_UNRELEASED_BASE) return process.env.CHANGELOG_UNRELEASED_BASE;
  try {
    return execSync(`git log -1 --grep='^chore(release):' --format=%H`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function fmt(e) {
  const scope = e.scope ? `**(${e.scope})** ` : "";
  const extra = e.mfs.filter((r) => !e.desc.includes(r));
  const refs = extra.length ? ` (${extra.join(", ")})` : "";
  return `- ${scope}${e.desc}${refs}`;
}

const base = lastReleaseCommit();
const range = base ? `${base}..HEAD` : "HEAD";

let raw;
try {
  raw = execSync(`git log ${range} --no-merges --format=%s${FS}%b${SEP}`, {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
} catch {
  process.exit(0);
}

const commits = raw
  .split(SEP)
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [s, b = ""] = r.split(FS);
    return { subject: s.trim(), body: (b || "").trim() };
  });

const groups = { Added: [], Fixed: [], Changed: [] };
for (const c of commits) {
  if (skip.test(c.subject) || /\[skip ci\]/.test(c.subject)) continue;
  const m = c.subject.match(conv);
  if (!m) continue;
  const [, type, scope, , desc] = m;
  const mfs = [...new Set((c.subject + " " + c.body).match(mfRe) || [])];
  if (type === "feat") groups.Added.push({ desc, scope, mfs });
  else if (type === "fix") groups.Fixed.push({ desc, scope, mfs });
  else if (type === "perf" || type === "refactor") groups.Changed.push({ desc, scope, mfs });
}

const total = groups.Added.length + groups.Fixed.length + groups.Changed.length;
if (!total) process.exit(0);

let text = readFileSync(changelogFile, "utf8");

const unreleasedRe = /(## \[Unreleased\]\n)([\s\S]*?)(\n## \[|\n$)/;
if (!unreleasedRe.test(text)) {
  console.error("changelog-unreleased: секция [Unreleased] не найдена — пропуск");
  process.exit(0);
}

for (const [name, list] of Object.entries(groups)) {
  const match = text.match(unreleasedRe);
  const existingBody = match[2];

  const fresh = list.filter((e) => {
    const line = fmt(e);
    if (existingBody.includes(line)) return false;
    if (e.mfs.some((r) => existingBody.includes(r))) return false;
    return true;
  });
  if (!fresh.length) continue;

  const heading = `### ${name}\n`;
  const newLines = fresh.map(fmt).join("\n");
  let replacement;
  if (existingBody.includes(heading)) {
    replacement = match[0].replace(heading, heading + newLines + "\n");
  } else {
    const insertion = existingBody.trimEnd()
      ? `${match[1]}${existingBody.trimEnd()}\n\n${heading}${newLines}\n`
      : `${match[1]}${heading}${newLines}\n`;
    replacement = insertion + match[3];
  }
  text = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
}

writeFileSync(changelogFile, text);
console.log(`changelog-unreleased: добавлено ${total} пункт(ов) в [Unreleased]`);
