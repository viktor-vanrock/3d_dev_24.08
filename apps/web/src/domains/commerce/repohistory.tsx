// «История проекта» (docs/design/projects.page.md §11.3, docs/epics/project.git.md §3.5):
// человеческий read-only журнал изменений поверх git-истории (GET /models/:id/history —
// MF-519/522), не git-лог. Свёрнута по умолчанию (§3.5/readme §2 — второстепенна к
// «скачать/README»), триггер-строка «История · обновлено N дней назад».
//
// Back ещё не переводит commit-subject в человеческий словарь событий (repository.ts отдаёт
// raw `git log` subject) — Front переводит сам по известным паттернам сообщений, которые
// реально пишет git-модуль (apps/api/src/git/repo.ts::commitReadme, upload.ts/files.ts). Если
// формат сообщения когда-нибудь изменится на бэке без синхронной правки здесь — честный
// fallback ниже показывает исходный subject, а не падает/врёт.
import { useState } from "react";
import { AvatarBubble, deterministicAvatarConfig } from "@shared/avatar";
import type { RepoHistoryCommit, UserProfile } from "./models.ts";
import "./repohistory.css";

const ADD_FILE_RE = /^feat: add (.+)$/;
const REMOVE_FILE_RE = /^chore: remove (.+)$/;
const README_UPDATE_SUBJECT = "docs: update README";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

// Экспортирован для тестов — словарь событий v1 (§11.3 таблица), выведенный из типа коммита,
// не raw-сообщение. Незнакомый формат сообщения — честный фолбэк на сам subject (не гадаем,
// не скрываем событие).
export function commitEventLabel(subject: string): string {
  const addMatch = ADD_FILE_RE.exec(subject);
  if (addMatch) return `Добавлен файл ${basename(addMatch[1]!)}`;
  const removeMatch = REMOVE_FILE_RE.exec(subject);
  if (removeMatch) return `Удалён файл ${basename(removeMatch[1]!)}`;
  if (subject === README_UPDATE_SUBJECT) return "Обновлено описание";
  return subject;
}

export interface HistoryEvent {
  sha: string;
  label: string;
  authoredAt: string;
}

// Коммиты приходят новейшим первым (`git log`, без --reverse — repo.ts::log). Самый старый
// (последний в массиве) — всегда «Проект создан» (§3.5: init + первый commit — одно событие),
// независимо от его буквального subject (первый коммит физически добавляет исходник, а не
// несёт отдельное «init»-сообщение).
export function buildHistoryEvents(commits: RepoHistoryCommit[]): HistoryEvent[] {
  return commits.map((commit, index) => ({
    sha: commit.sha,
    authoredAt: commit.authored_at,
    label: index === commits.length - 1 ? "Проект создан" : commitEventLabel(commit.subject),
  }));
}

function HistoryGlyph() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DisclosureChevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="repoHistoryChevron" data-open={open || undefined}>
      <path d="m8 5 8 7-8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Единственный писатель истории в v1 — владелец проекта (§11.3: «аватар обычно один и тот же —
// допустимо схлопнуть повтор»); аватар/автор строки берём из карточки модели (`owner`), а не из
// git author_name/email отдельным запросом — тот же человек на каждой строке, лишнего API не
// нужно. Форк (второй возможный автор в будущем) переносит владельца копии — тоже owner карточки.
export function RepoHistory({
  commits,
  owner,
  relativeDate,
}: {
  commits: RepoHistoryCommit[];
  owner: Pick<UserProfile, "id" | "username" | "display_name" | "avatar_config" | "avatar_snapshots">;
  relativeDate: (iso: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (commits.length === 0) return null;

  const events = buildHistoryEvents(commits);
  const latest = events[0]!;

  return (
    <section className="repoHistory" aria-label="История проекта">
      <button
        type="button"
        className="repoHistoryTrigger pressable"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="repoHistoryTriggerGlyph" aria-hidden="true">
          <HistoryGlyph />
        </span>
        <span className="repoHistoryTriggerLabel">История</span>
        <span className="repoHistoryTriggerMeta">обновлено {relativeDate(latest.authoredAt)}</span>
        <DisclosureChevron open={open} />
      </button>
      {open ? (
        <ul className="repoHistoryList">
          {events.map((event) => (
            <li className="repoHistoryRow" key={event.sha}>
              {owner.avatar_config ? (
                <AvatarBubble
                  config={owner.avatar_config}
                  snapshots={owner.avatar_snapshots ?? null}
                  size={36}
                  facing="front"
                />
              ) : (
                <AvatarBubble
                  config={deterministicAvatarConfig(owner.username || owner.id)}
                  snapshots={null}
                  size={36}
                  facing="front"
                />
              )}
              <span className="repoHistoryAuthor">@{owner.username}</span>
              <span className="repoHistoryEvent">{event.label}</span>
              <span className="repoHistoryTime" title={new Date(event.authoredAt).toLocaleString("ru-RU")}>
                {relativeDate(event.authoredAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
