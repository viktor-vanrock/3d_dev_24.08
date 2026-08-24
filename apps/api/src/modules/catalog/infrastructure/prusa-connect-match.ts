import { pool } from "../../../db/client.ts";

// Сопоставление модели, которую вернул Prusa Connect (printerTypeName вида "MK4S"/"MINI+"),
// с канонической записью machines (model вида "Prusa MK4S", "Prusa MINI"). Узкий матчер под
// один вендор с известными строками — НЕ общий entity-resolution пайплайн каталога
// (blocking→matching→merge из machine_candidates, см. docs/epics/domain.model.md § «Каталог
// станков» — тот пайплайн ещё не реализован и не входит в эту карточку). Нормализация: убираем
// вендорские слова и любые не-буквенно-цифровые символы, чтобы "MINI+" == "Prusa MINI" и
// "MK4S" == "Prusa MK4S" сходились без ручных алиасов.
const VENDOR_SLUG = "prusa-research";
const NOISE_WORDS = /\b(original|prusa|research|i3)\b/gi;

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(NOISE_WORDS, "")
    .replace(/[^a-z0-9]+/g, "");
}

interface MachineRow {
  id: string;
  model: string;
  aliases: string[];
}

export async function matchPrusaModel(modelName: string): Promise<string | null> {
  const needle = normalize(modelName);
  if (!needle) return null;

  const result = await pool.query<MachineRow>(
    `select m.id, m.model, m.aliases
     from machines m
     join vendors v on v.id = m.vendor_id
     where v.slug = $1 and m.status = 'active'`,
    [VENDOR_SLUG],
  );

  for (const row of result.rows) {
    const candidates = [row.model, ...(row.aliases ?? [])];
    if (candidates.some((candidate) => normalize(candidate) === needle)) return row.id;
  }
  return null;
}

export async function catalogCompatibilityMachines(ids: readonly string[]): Promise<
  ReadonlyMap<
    string,
    {
      readonly kind: string;
      readonly specs: Readonly<Record<string, unknown>>;
    }
  >
> {
  if (ids.length === 0) return new Map();
  const result = await pool.query<{ id: string; kind: string; specs: Readonly<Record<string, unknown>> }>(`select id, kind, specs from machines where id = any($1::uuid[])`, [ids]);
  return new Map(result.rows.map((row) => [row.id, { kind: row.kind, specs: row.specs }]));
}

export async function catalogComboLabels(
  machineIds: readonly string[],
  materialIds: readonly string[],
): Promise<{
  readonly machines: ReadonlyMap<string, string>;
  readonly materials: ReadonlyMap<string, string>;
}> {
  const [machines, materials] = await Promise.all([
    machineIds.length === 0
      ? { rows: [] as { id: string; model: string }[] }
      : pool.query<{ id: string; model: string }>(`select id, model from machines where id = any($1::uuid[])`, [machineIds]),
    materialIds.length === 0
      ? { rows: [] as { id: string; name: string }[] }
      : pool.query<{ id: string; name: string }>(`select id, name from materials where id = any($1::uuid[])`, [materialIds]),
  ]);
  return {
    machines: new Map(machines.rows.map((row) => [row.id, row.model])),
    materials: new Map(materials.rows.map((row) => [row.id, row.name])),
  };
}
