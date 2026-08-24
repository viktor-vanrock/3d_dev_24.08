import { useCallback, useEffect, useState } from "react";
import type {
  GetProjectManifestResult,
  PutProjectManifestRequest,
  ResolvedProjectGraph,
} from "@portal/contracts/http/models";
import { getProjectManifest, putProjectManifest, type PutProjectManifestOutcome } from "./models.ts";
import "./projectmanifest.css";

type LoadManifest = (modelId: string) => Promise<GetProjectManifestResult | null>;
type SaveManifest = (modelId: string, request: PutProjectManifestRequest) => Promise<PutProjectManifestOutcome>;

export function ProjectManifestEditor({
  modelId,
  onClose,
  load = getProjectManifest,
  save = putProjectManifest,
}: {
  modelId: string;
  onClose: () => void;
  load?: LoadManifest;
  save?: SaveManifest;
}) {
  const [source, setSource] = useState<GetProjectManifestResult | null>();
  const [manifest, setManifest] = useState<ResolvedProjectGraph | null>(null);
  const [advancedJson, setAdvancedJson] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const reload = useCallback(async () => {
    setSource(undefined);
    setNotice(null);
    setConflict(false);
    const result = await load(modelId);
    setSource(result);
    setManifest(result?.manifest ?? null);
    setAdvancedJson(result ? JSON.stringify(result.manifest, null, 2) : "");
  }, [load, modelId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function changeTitle(title: string) {
    setManifest((current) => {
      if (!current) return current;
      const next = { ...current, project: { ...current.project, title } };
      setAdvancedJson(JSON.stringify(next, null, 2));
      return next;
    });
    setNotice(null);
  }

  function changeAdvanced(value: string) {
    setAdvancedJson(value);
    setNotice(null);
    try {
      const parsed = JSON.parse(value) as ResolvedProjectGraph;
      setManifest(parsed);
      setAdvancedError(null);
    } catch {
      setAdvancedError("Проверьте структуру JSON: сейчас её нельзя сохранить.");
    }
  }

  async function submit() {
    if (!source || !manifest || advancedError || saving) return;
    setSaving(true);
    setNotice(null);
    const result = await save(modelId, {
      contract_version: "project-code.v1",
      base_head_sha: source.head_sha,
      manifest,
      commit_message: `Обновить настройки проекта: ${manifest.project.title}`,
    });
    setSaving(false);
    if (result.ok) {
      setSource((current) => (current ? { ...current, head_sha: result.value.head_sha } : current));
      setConflict(false);
      setNotice("Изменения сохранены");
      return;
    }
    if (result.conflict) {
      setConflict(true);
      return;
    }
    setNotice("Не удалось сохранить изменения. Попробуйте ещё раз.");
  }

  if (source === undefined) return <div className="projectManifestState" role="status">Загружаем настройки…</div>;
  if (!source || !manifest) return <div className="projectManifestState" role="alert">Не удалось загрузить настройки проекта.</div>;

  return (
    <form className="projectManifestEditor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="projectManifestLead">Настройте состав, варианты сборки и порядок работ. История изменений сохранится автоматически.</p>

      {conflict ? (
        <div className="projectManifestConflict" role="alert">
          <strong>Кто-то изменил проект, пока вы его редактировали.</strong>
          <span>Ваша правка осталась в форме. Перечитайте актуальную версию, когда будете готовы сверить изменения.</span>
          <button type="button" className="modelGlassBtn pressable" onClick={() => void reload()}>Перечитать актуальную версию</button>
        </div>
      ) : null}

      <label className="projectManifestField">
        <span>Название проекта</span>
        <input value={manifest.project.title} onChange={(event) => changeTitle(event.currentTarget.value)} required />
      </label>

      <details className="projectManifestAdvanced">
        <summary>Расширенные настройки состава</summary>
        <p>Здесь доступны конфигурации, детали, сцены и этапы работ. Неизвестные расширения сохраняются без изменений.</p>
        <label className="projectManifestField">
          <span>Структура проекта (JSON)</span>
          <textarea value={advancedJson} onChange={(event) => changeAdvanced(event.currentTarget.value)} spellCheck={false} rows={18} />
        </label>
        {advancedError ? <div role="alert" className="projectManifestInlineError">{advancedError}</div> : null}
      </details>

      {notice ? <div role="status" className="projectManifestNotice">{notice}</div> : null}
      <div className="projectManifestActions">
        <button type="button" className="modelGlassBtn pressable" onClick={onClose}>Отмена</button>
        <button type="submit" className="modelGlassBtn modelPrintBtn pressable" disabled={saving || Boolean(advancedError)}>
          {saving ? "Сохраняем…" : "Сохранить проект"}
        </button>
      </div>
    </form>
  );
}
