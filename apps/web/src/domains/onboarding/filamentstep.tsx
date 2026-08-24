import { useEffect, useState } from "react";
import { fetchPopularMaterials, type CatalogMaterial, type ActivationState } from "@shared/lib";
import { Card, Chip } from "@shared/ui";

// Опц. шаг «ваш пластик» (MF-437 § «Опц. шаг «ваш пластик» (MF-31)»): 1-2 чипа частых
// (PLA/PETG) из каталога, «пропустить» на видном месте. GET /materials (MF-624) не отдаёт
// текстовый поиск (только vendor/type/kind-фильтры) — эпик тоже не просит поиск на этом шаге,
// только чипы + пропуск, поэтому строки «найти» здесь нет (в отличие от picker'а принтера).
// Каталог филамента сейчас без собственного импортёра (в отличие от станков MF-405) — чипов
// может не быть, это ожидаемо и не блокирует пропуск шага.

export function FilamentStep({
  addFilament,
  onDone,
}: {
  addFilament: ActivationState["addFilament"];
  onDone: () => void;
}) {
  const [popular, setPopular] = useState<CatalogMaterial[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPopularMaterials().then(setPopular);
  }, []);

  async function pick(material: CatalogMaterial) {
    if (busy) return;
    setBusy(true);
    await addFilament(material);
    setBusy(false);
    onDone();
  }

  return (
    <Card style={{ padding: "clamp(18px, 3.5vw, 28px)", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 17 }}>Каким пластиком печатаете?</div>
        <button type="button" className="homeSkipLink pressable" style={{ alignSelf: "auto", padding: 0 }} onClick={onDone}>
          Пропустить
        </button>
      </div>
      {popular.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {popular.map((material) => (
            <Chip key={material.id} onClick={() => pick(material)}>
              {material.brand} {material.name}
            </Chip>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
