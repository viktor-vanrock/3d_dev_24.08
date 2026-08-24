#!/usr/bin/env node
// Генерирует секцию changelog.md (Keep a Changelog) по диапазону git-коммитов.
// Владелец процесса — роль Git (релиз-инженер), см. docs/process/versioning.md.
//
// Использование:
//   node scripts/changelog.mjs <range> [--version X.Y.Z] [--date YYYY-MM-DD]
// Пример (нарезка релиза):
//   node scripts/changelog.mjs v26.2.1..origin/main --version 26.3.1
//
// Логика: feat → Added, fix → Fixed, perf/refactor → Changed, неконвенциональные →
// Прочее; docs/chore/ci/test/build/style → сворачиваются в «Внутреннее» (счётчики),
// чтобы changelog показывал ЗАМЕТНОЕ, а не каждый doc-коммит (versioning.md § Changelog).
// MF-N ссылки из заголовка/тела подтягиваются для трассируемости. Строку-итог релиза
// оставляет плейсхолдером — её пишет человек/CTO (голос оператора).
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const range = args.find((a) => !a.startsWith("--"));
if (!range) {
  console.error("usage: changelog.mjs <range> [--version X.Y.Z] [--date YYYY-MM-DD]");
  process.exit(1);
}
const flag = (n) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : null;
};
const version = flag("version");
const date = flag("date") || new Date().toISOString().slice(0, 10);

const SEP = "\x1e", FS = "\x1f";
const raw = execSync(`git log ${range} --no-merges --format=%s${FS}%b${SEP}`, {
  encoding: "utf8",
  maxBuffer: 1 << 26,
});
const commits = raw
  .split(SEP)
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [s, b = ""] = r.split(FS);
    return { subject: s.trim(), body: b.trim() };
  });

const skip = /^(chore\(release\)|Merge |sync main)/i;
const conv = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const mfRe = /MF-\d+/g;

const groups = { Added: [], Fixed: [], Changed: [] };
const internal = {};
const other = [];

for (const c of commits) {
  if (skip.test(c.subject) || /\[skip ci\]/.test(c.subject)) continue;
  const mfs = [...new Set((c.subject + " " + c.body).match(mfRe) || [])];
  const m = c.subject.match(conv);
  if (!m) {
    other.push({ desc: c.subject, scope: null, mfs });
    continue;
  }
  const [, type, scope, , desc] = m;
  const entry = { desc, scope, mfs };
  if (type === "feat") groups.Added.push(entry);
  else if (type === "fix") groups.Fixed.push(entry);
  else if (type === "perf" || type === "refactor") groups.Changed.push(entry);
  else internal[type] = (internal[type] || 0) + 1;
}

const fmt = (e) => {
  const scope = e.scope ? `**(${e.scope})** ` : "";
  // не дублировать MF-ссылки, уже присутствующие в тексте заголовка
  const extra = e.mfs.filter((r) => !e.desc.includes(r));
  const refs = extra.length ? ` (${extra.join(", ")})` : "";
  return `- ${scope}${e.desc}${refs}`;
};

let out = "";
if (version) out += `## [${version}] — ${date}\n\n`;
out += `> _итог релиза одной строкой — заполнить: что главное принёс этот релиз_\n\n`;
for (const [name, list] of Object.entries(groups)) {
  if (!list.length) continue;
  out += `### ${name}\n` + list.map(fmt).join("\n") + "\n\n";
}
if (other.length) out += `### Прочее\n` + other.map(fmt).join("\n") + "\n\n";
const intParts = Object.entries(internal)
  .sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `${t} ${n}`);
if (intParts.length)
  out += `### Внутреннее\n- Непользовательские изменения: ${intParts.join(", ")} (полная история — \`git log ${range}\`).\n\n`;

process.stdout.write(out.trimEnd() + "\n");
