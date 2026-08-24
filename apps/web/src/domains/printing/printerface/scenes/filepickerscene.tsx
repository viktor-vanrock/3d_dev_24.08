import { ActionCard, EmptyState, Eyebrow } from "@shared/ui";
import type { FaceFiles } from "../facesource.ts";

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V8h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 18a4 4 0 0 1-.4-7.98A5 5 0 0 1 16.3 8.1 4.5 4.5 0 0 1 16 18H7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Сцена (e) — выбор файла для печати (printer.face.md §2.3.e): локальные файлы принтера сверху,
// «Из портала» — вторым секшеном, ТОЛЬКО когда relay-туннель поднят (files.portal !== null,
// §2.5 честность оффлайна — не мёртвая пустая секция, а полное отсутствие).
export function FilePickerScene({
  files,
  onPickLocal,
  onPickPortal,
  onOpenPortalOnPhone,
}: {
  files: FaceFiles;
  onPickLocal: (name: string) => void;
  onPickPortal: (id: string, name: string) => void;
  onOpenPortalOnPhone: () => void;
}) {
  const nothing = files.local.length === 0 && (!files.portal || files.portal.length === 0);

  if (nothing) {
    return (
      <div className="faceScene faceScene--files reveal">
        <EmptyState
          icon={<CloudIcon />}
          title="Пока нечего печатать"
          sub="Загрузите файл на принтер или в проект на портале"
          action={
            <button type="button" className="faceGhostLink pressable" onClick={onOpenPortalOnPhone}>
              Открыть портал на телефоне
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="faceScene faceScene--files reveal">
      <Eyebrow>Файл для печати</Eyebrow>
      {files.local.length > 0 ? (
        <div className="faceFileList">
          {files.local.map((name) => (
            <ActionCard key={name} title={name} icon={<FileIcon />} onClick={() => onPickLocal(name)} />
          ))}
        </div>
      ) : null}

      {files.portal && files.portal.length > 0 ? (
        <>
          <Eyebrow>Из портала</Eyebrow>
          <div className="faceFileList">
            {files.portal.map((project) => (
              <ActionCard
                key={project.id}
                variant="secondary"
                title={project.name}
                icon={<FileIcon />}
                onClick={() => onPickPortal(project.id, project.name)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
