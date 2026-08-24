# Git-модуль apps/api — контракт

Стейдж 1 эпика [MF-514](../epics/project.git.md) ([MF-515](../epics/project.git.md), спайк). Прототип
и тесты: `apps/api/src/git/*`. Прод-вайринг (стейдж 2, [MF-519](../epics/project.git.md)) реализован:
`models/upload.ts` (init-репо + commit исходника + commit README при создании),
`models/mutate.ts` (commit README при правке описания, удаление репо при удалении проекта),
`models/repository.ts` (`GET /models/:id/{tree,readme,history}` с fallback-флагом «репо есть/нет»
из `models.repo_path`). Резолвинг `projectId → repoPath` — `apps/api/src/git/paths.ts`
(`GIT_REPOS_DIR`, дефолт `/srv/git/repos`, см. MF-518). Backfill существующих публикаций —
стейдж 3 (MF-521), ещё не сделан.

## Модель

Каждый проект = один bare git-репозиторий на диске VDS (`git init --bare`). Единственный писатель
в v1 — `apps/api`, через git CLI (`node:child_process`), без библиотек типа isomorphic-git/nodegit —
принцип «нулевые новые зависимости» (§3 эпика). Резолвинг `projectId → путь на диске` — забота
вызывающего кода (`models.repo_path`, маппинг фиксирует Data), не этого модуля: каждая функция
принимает готовый абсолютный `repoPath`.

## Файлы

| Файл | Назначение |
|---|---|
| `gitcli.ts` | `runGit(args, {cwd?, env?, input?})` — низкоуровневый спавн `git`, Buffer stdin/stdout (нужно для бинарных исходников моделей). `GitCommandError` при ненулевом коде возврата. |
| `lock.ts` | `withRepoLock(repoPath, fn, timeoutMs?)` — сериализация записей в один репозиторий. |
| `limits.ts` | Лимиты §3.6: `MAX_FILE_BYTES` (100 МБ), `MAX_REPO_BYTES` (1 ГБ), `assertFileSizeAllowed`, `assertRepoSizeAllowed`/`assertRepoSizeBytesAllowed`, `repoSizeBytes`. |
| `repo.ts` | Публичный контракт модуля (см. ниже). |

## Публичный контракт (`repo.ts`)

```ts
initBareRepo(repoPath: string): Promise<void>
// git init --bare. Вызывается один раз при создании проекта.

commitFile(repoPath: string, input: CommitFileInput): Promise<string /* commit sha */>
// input: { filePath, content: Buffer, message, author: { name, email }, branch? = "main" }
// Единственная операция записи. Под локом репозитория: read-tree(parent) → hash-object -w
// → update-index → write-tree → commit-tree → update-ref. Бросает FileTooLargeError /
// RepoTooLargeError (limits.ts) при превышении лимитов, Error при небезопасном filePath
// (абсолютный путь или содержит "..").

commitReadme(repoPath: string, description: string, author: CommitAuthor, branch?): Promise<string>
// Обёртка над commitFile: filePath = "README.md", content = description как UTF-8.

readTree(repoPath: string, ref?: string = "main"): Promise<TreeEntry[]>
// git ls-tree -r -l <ref> — плоский рекурсивный список файлов. [] для ещё не родившейся
// ветки (пустой репозиторий), не ошибка. TreeEntry: { mode, type: blob|tree|commit, sha,
// path, sizeBytes: number|null }.

log(repoPath: string, ref?: string = "main", limit?: number): Promise<LogEntry[]>
// git log — новые коммиты первыми. [] для пустого репозитория. LogEntry: { sha, authorName,
// authorEmail, authoredAt (ISO), subject }.

forkRepo(sourceRepoPath: string, targetRepoPath: string): Promise<void>
// Server-side git clone --bare. Карточка с forked_from — забота вызывающего кода (models).

readFileContent(repoPath: string, filePath: string, ref?: string = "main"): Promise<Buffer | null>
// git show <ref>:<filePath> — байты одного файла (добавлено стейджем 2 под GET /readme;
// readTree выше даёт только метаданные дерева, не содержимое). null для отсутствующего
// файла/ветки, тот же принцип "пусто — не ошибка".

removeRepo(repoPath: string): Promise<void>
// rm -rf репозитория целиком (добавлено стейджем 2) — откат неудачного init/commit при
// создании проекта, удаление bare-репо при удалении проекта юзером.
```

## Стратегия лок per repo (критерий приёмки MF-515 п.3)

Коммит в bare-репо строится через plumbing поверх **временного index-файла внутри самого
репозитория** (`<repoPath>/portal-index`) — это разделяемое мутируемое состояние: два
одновременных коммита в один репозиторий гонялись бы за этим файлом (не за самим git — объекты
в `objects/` immutable и append-only, конфликт именно на индексе и на `update-ref`).

Реализация — эксклюзивный файл-лок `<repoPath>/portal.lock`, создаётся через
`fs.open(path, "wx")` (атомарный `O_CREAT|O_EXCL`, POSIX-гарантия). Живёт на той же файловой
системе, что и репозитории → работает и при нескольких процессах на одном диске (v1 — один
writer, `apps/api`, но без переделки годится и на будущее). Опрос с интервалом 25мс,
`timeoutMs` по умолчанию 10с, `RepoLockTimeoutError` при истечении.

**Проверено тестом** (`repo.test.ts` → `concurrent commits to the same repo`): 8 параллельных
`commitFile` в один репозиторий — все 8 коммитов и файлов выживают, ни один не потерян.

**Известное упрощение (открытый вопрос для стейджа 2, не блокирует спайк):** нет детекции
зависшего лока от упавшего процесса (stale lock, нет TTL/PID в файле). Для v1 с одним
процессом-писателем и коротким временем удержания (одна git-операция) риск низкий.

## Лимиты (критерий приёмки MF-515 п.3, §3.6 эпика)

- Файл ≤ **100 МБ** (`MAX_FILE_BYTES`, тот же физический лимит, что `MAX_UPLOAD_BYTES` в
  `models/upload.ts`) — проверяется до записи blob'а (`assertFileSizeAllowed`).
- Репозиторий ≤ **1 ГБ** (`MAX_REPO_BYTES`) — проверяется перед началом коммита
  (`assertRepoSizeAllowed`, рекурсивный обход каталога репо на диске). Это проверка «уже
  превышен лимит → отклонить новую запись», не пост-коммитный жёсткий потолок — следующий
  коммит может на несколько КБ перевалить за 1 ГБ. Хватает для спайка; уточняется по факту
  (эпик §8 п.3).
- Git LFS в v1 не вводим (§3 п.6 эпика) — бинарники лежат в git как есть.

**Проверено тестом:** граничные значения (`=MAX_FILE_BYTES` пропускает, `+1` байт бросает
`FileTooLargeError`/`RepoTooLargeError`).

## Что НЕ входит в контракт (вне эпика / ещё не сделано)

- Backfill существующих публикаций (проставить `repo_path` старым строкам) — стейдж 3, MF-521.
- Форк-эндпоинт (`POST /models/:id/fork`, кнопка «Форк» на Front) — `forkRepo` в модуле готов,
  HTTP-ручка и `models.forked_from`-вайринг — отдельная карточка стейджа 3 (Front MF-522/MF-512).
- Git-протокол наружу, LFS, форж — вне эпика (§5).

Реализовано стейджем 2 ([MF-519](../epics/project.git.md)): HTTP-роуты дерева/README/истории
(`models/repository.ts`), конвенция структуры каталогов репо (`apps/api/src/git/paths.ts`,
маппинг Data §10.2), резолвинг `projectId → repoPath` (`GIT_REPOS_DIR` + `models.repo_path`).

## Читатель вне apps/api: apps/mesh (стейдж 3, MF-520)

`apps/api` — единственный **писатель**, но не единственный процесс, читающий репо. Конвейер
конвертации (`portal.mesh-worker.service`) забирает исходник (`role='source'`) из репо проекта,
если у модели уже проставлен `models.repo_path` — иначе fallback на старый S3-путь (§3.7, до
бэкафилла стейджа 3/MF-521). Оба процесса живут на одной VDS (тот же `User=plag`, тот же принцип,
что уже даёт воркеру прямой доступ к Postgres/S3 в обход HTTP) — отдельного GET-контракта под
байты source-файла не заводили: `apps/mesh/src/mesh/repo.py` читает `git show <ref>:<path>`
напрямую с `GIT_DIR=$GIT_REPOS_DIR/<repo_path>`, той же plumbing-стилистикой, что и
`readFileContent` в этом модуле, но без записи и без лока (единственный писатель по-прежнему
только `apps/api`). Путь файла в репо воркер вычисляет тем же правилом, что `repoFilePath` в
`git/paths.ts` (папка по `models.craft`, имя файла — `model_files.original_filename`).
