import { navigate } from "../../../router.ts";
import { useInteractionSound } from "@platform/sound";
import { Button } from "@shared/ui";
import "./printers.css";

// `GapRow` — новый переиспользуемый примитив (docs/design/printers.catalog.md §2.9/§9):
// «неизвестное не молчит» — нейтральное приглашение под сеткой, когда активный фасет исключил
// принтеры с `null` в отфильтрованном поле. Роль-зависимое действие: гость/владелец раскрывает
// хвост сетки на месте, `researcher` уходит дозаполнять очередь по этому полю.

export interface GapRowProps {
  field: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  isResearcher: boolean;
}

function printerNoun(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "принтеров, у которых";
  if (mod10 === 1) return "принтер, у которого";
  if (mod10 >= 2 && mod10 <= 4) return "принтера, у которых";
  return "принтеров, у которых";
}

export function GapRow({ field, count, expanded, onToggle, isResearcher }: GapRowProps) {
  const sound = useInteractionSound();
  return (
    <div className="prnGapRow">
      <Button
        variant="ghost"
        icon={null}
        className="prnGapRowMain"
        onClick={() => {
          sound.tick();
          onToggle();
        }}
        aria-expanded={expanded}
      >
        Ещё {count} {printerNoun(count)} не заполнено «{field}» — {expanded ? "скрыть" : "показать"}
      </Button>
      {isResearcher ? (
        <Button
          variant="ghost"
          icon={null}
          className="prnGapRowResearch"
          onClick={() => {
            sound.tick();
            navigate(`/research?facet=${encodeURIComponent(field)}`);
          }}
        >
          Дозаполнить →
        </Button>
      ) : null}
    </div>
  );
}
