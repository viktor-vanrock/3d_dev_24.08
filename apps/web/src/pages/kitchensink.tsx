import { useState, type CSSProperties, type ReactNode } from "react";
import { useOverlay } from "@platform/overlay";
import { ThemeToggle } from "@platform/theme";
import { AuroraBackground, ReasonPanel, SegmentToggle, Vote, type VoteVariant, ActionCard, AgentBadge, Card, Checklist, Chip, EmptyState, Eyebrow, Heading, IconButton, Input, FieldGroup, SelectField, StatusDot, StatusPill, Button, TextField, TextareaField, type ChecklistStep, type StatusTone } from "@shared/ui";

// Стенд-витрина всей библиотеки apps/web/src/ui (эпик MF-40/MF-426): каждый компонент —
// во всех состояниях (default/active/disabled/тона), плюс тумблер темы, чтобы одним взглядом
// сверить и светлую, и тёмную тему. Без auth-гейта — открывается прямо на #/kitchen-sink.
export function KitchenSinkPage() {
  const overlay = useOverlay();
  const [selectedChip, setSelectedChip] = useState(0);
  const [selectedTab, setSelectedTab] = useState<"catalog" | "new">("catalog");
  const [checklistSteps, setChecklistSteps] = useState<ChecklistStep[]>([
    { id: "1", title: "Заполните профиль", done: true },
    { id: "2", title: "Загрузите первую модель", done: false },
    { id: "3", title: "Подключите принтер", done: false },
  ]);
  const tones: StatusTone[] = ["ok", "warn", "danger", "dim"];

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <AuroraBackground />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "24px 16px 80px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <Heading size="md" accent="sink">
            Kitchen
          </Heading>
          <ThemeToggle />
        </div>

        <Section title="Figma 3D портал · Button">
          <Row>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="tertiary">Tertiary</Button>
            <Button variant="translucent">Translucent</Button>
            <Button variant="transparent">Transparent</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
          </Row>
          <Row>
            <Button size="l">Large</Button>
            <Button size="m">Medium</Button>
            <Button size="s">Small</Button>
            <Button size="xs">X-small</Button>
          </Row>
          <Eyebrow>Иконка слева / справа</Eyebrow>
          <Row>
            <Button variant="secondary" icon={<ArrowBackIcon />} iconPosition="start">
              Назад
            </Button>
            <Button icon={<ArrowForwardIcon />} iconPosition="end">
              Продолжить
            </Button>
            <Button variant="accent" icon={<PlusIcon />} iconPosition="start">
              Добавить
            </Button>
            <Button variant="tertiary" icon={<ArrowForwardIcon />} iconPosition="end">
              Открыть
            </Button>
          </Row>
        </Section>

        <Section title="Figma 3D портал · Icon Button">
          <Row>
            <IconButton label="Назад" variant="primary" size="l">
              <ArrowBackIcon />
            </IconButton>
            <IconButton label="Уведомления" variant="secondary" badge={3}>
              <BellIcon />
            </IconButton>
            <IconButton label="Уведомления" variant="accent" size="s" badge={12}>
              <BellIcon />
            </IconButton>
            <IconButton label="Прозрачная кнопка" variant="transparent" size="xs">
              <PlusIcon />
            </IconButton>
          </Row>
        </Section>

        <Section title="Figma 3D портал · Tabs">
          <SegmentToggle
            ariaLabel="Раздел каталога"
            value={selectedTab}
            onChange={setSelectedTab}
            options={[
              { value: "catalog", label: "Каталог" },
              { value: "new", label: "Новинки" },
            ]}
          />
        </Section>

        <Section title="Figma 3D портал · Fields">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
            <TextField label="Название проекта" placeholder="Например, лампа-луна" hint="До 80 символов" leading={<SearchIcon />} />
            <TextField
              label="Ссылка на репозиторий"
              defaultValue="gitverse.ru/plag/portal"
              trailing={<ArrowUpRightIcon />}
            />
            <TextField label="Обязательное поле" placeholder="Введите значение" error="Поле нужно заполнить" />
            <SelectField label="Способ изготовления" hint="Можно изменить позже" defaultValue="fdm">
              <option value="fdm">FDM / 3D-печать</option>
              <option value="sla">SLA / смола</option>
              <option value="cnc">ЧПУ</option>
            </SelectField>
          </div>
          <TextareaField
            label="Описание"
            placeholder="Расскажите, что получится и как это собрать…"
            hint="Markdown, изображения, 3D-модели и репозитории добавляются блоками"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
            <Eyebrow>Legacy-compatible primitives</Eyebrow>
            <Input placeholder="Обычное поле" />
            <Input placeholder="Отключено" disabled />
            <FieldGroup>
              <input placeholder="ivan.petrov" />
              <select defaultValue="sber.ru" aria-label="Домен почты">
                <option value="sber.ru">@sber.ru</option>
              </select>
            </FieldGroup>
          </div>
        </Section>

        <Section title="StatusDot / StatusPill">
          <Row>
            {tones.map((tone) => (
              <StatusDot key={tone} tone={tone} />
            ))}
            <StatusDot tone="warn" pulse />
          </Row>
          <Row>
            {tones.map((tone) => (
              <StatusPill key={tone} tone={tone}>
                {tone}
              </StatusPill>
            ))}
            <StatusPill tone="danger" pulse>
              требует внимания
            </StatusPill>
          </Row>
        </Section>

        <Section title="AgentBadge">
          <Row>
            <AgentBadge />
            <StatusPill tone="ok">На рассмотрении</StatusPill>
            <AgentBadge />
          </Row>
          <Row>
            <span style={{ color: "var(--text)" }}>@nick · 2 ч назад</span>
            <AgentBadge />
          </Row>
        </Section>

        <Section title="Figma 3D портал · Chips">
          <Row>
            {["STL", "STEP", "3MF"].map((label, index) => (
              <Chip key={label} size="s" selected={selectedChip === index} onClick={() => setSelectedChip(index)}>
                {label}
              </Chip>
            ))}
            <Chip size="xs">Сезонное</Chip>
            <Chip size="m" disabled>Недоступно</Chip>
          </Row>
        </Section>

        <Section title="Vote (голосовалка идей, docs/design/ideas.md §5)">
          <Eyebrow>compact</Eyebrow>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(124px, 1fr))", gap: 10 }}>
            <DemoState label="Обычная">
              <VoteDemo variant="compact" initialCount={128} initialVoted={false} />
            </DemoState>
            <DemoState label="Ваш голос">
              <VoteDemo variant="compact" initialCount={47} initialVoted />
            </DemoState>
            <DemoState label="Своя идея">
              <Vote variant="compact" voteCount={12} hasVoted={false} reason="own" />
            </DemoState>
            <DemoState label="Гость">
              <Vote
                variant="compact"
                voteCount={9}
                hasVoted={false}
                reason="guest"
                onToggle={() => {
                  overlay.toast({ severity: "warn", title: "Войдите, чтобы голосовать" });
                }}
              />
            </DemoState>
            <DemoState label="Архив">
              <Vote variant="compact" voteCount={301} hasVoted reason="archived" />
            </DemoState>
            <DemoState label="Ошибка сети">
              <VoteDemo variant="compact" initialCount={5} initialVoted={false} failNext />
            </DemoState>
          </div>
          <Eyebrow>large</Eyebrow>
          <Row>
            <VoteDemo variant="large" initialCount={128} initialVoted={false} />
            <Vote variant="large" voteCount={64} hasVoted={false} reason="own" />
          </Row>
          <Eyebrow>inline (строка дедупа формы)</Eyebrow>
          <Row>
            <VoteDemo variant="inline" initialCount={128} initialVoted={false} />
            <VoteDemo variant="inline" initialCount={47} initialVoted />
          </Row>
        </Section>

        <Section title="ReasonPanel (блок публичной причины, docs/design/ideas.md §3.3)">
          <ReasonPanel tone="danger" title="Отклонена" reason="Дублирует уже реализованную фичу сортировки по цвету — см. каталог принтеров." />
          <ReasonPanel
            tone="dim"
            title="Дубликат идеи"
            reason="Похожая идея уже предложена и набирает голоса — голосуйте за оригинал."
            canonicalHref="#/issue/example-canonical"
          />
        </Section>

        <Section title="Card / ActionCard">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card style={{ padding: 20 }}>
              <Eyebrow>Card</Eyebrow>
              <div style={{ color: "var(--text)", marginTop: 6 }}>Стеклянная карточка — базовая обёртка контента.</div>
            </Card>
            <ActionCard title="Добавить модель" sub="STL · STEP · 3MF, до 100 МБ" icon={<PlusIcon />} onClick={() => {}} />
            <ActionCard title="Primary action" sub="Один primary на экран" icon={<PlusIcon />} variant="primary" onClick={() => {}} />
          </div>
        </Section>

        <Section title="Overlay modal">
          <Row>
            <Button
              variant="secondary"
              icon={null}
              onClick={() => overlay.modal({ title: "Короткое подтверждение", content: <div>Вариант compact для коротких сообщений.</div> })}
            >
              Открыть compact-модалку
            </Button>
            <Button
              variant="secondary"
              icon={null}
              onClick={() => overlay.modal({ title: "Форма принтера", size: "form", content: <div>Вариант form для выбора и редактирования сущности.</div> })}
            >
              Открыть form-модалку
            </Button>
            <Button
              variant="secondary"
              icon={null}
              onClick={() => overlay.modal({ title: "Редактирование проекта", size: "wide", content: <div>Вариант wide для многострочной формы.</div> })}
            >
              Открыть wide-модалку
            </Button>
          </Row>
        </Section>

        <Section title="Checklist">
          <Checklist
            title="Активация"
            steps={checklistSteps}
            onStep={(id) =>
              setChecklistSteps((prev) => prev.map((step) => (step.id === id ? { ...step, done: !step.done } : step)))
            }
            onDismiss={() => {}}
          />
        </Section>

        <Section title="EmptyState">
          <EmptyState
            icon={<PlusIcon />}
            title="Здесь пока пусто"
            sub="Пример пассивного обучающего слоя"
            action={
              <Button type="button" icon={null}>
                Действие
              </Button>
            }
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={sectionStyle}>
      <Eyebrow>{title}</Eyebrow>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>{children}</div>;
}

function DemoState({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: 84,
        padding: 12,
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "color-mix(in srgb, var(--surface) 42%, transparent)",
      }}
    >
      <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{label}</span>
      {children}
    </div>
  );
}

// Живой пример Vote: тоггл реально меняет count/voted через onToggle (docs/design/ideas.md §5
// «оптимистичный апдейт», не только статичная картинка состояния). `failNext` — единственный
// пример, симулирующий отказ сети (откат + тихий тост), чтобы вживую проверить §5 «на ошибку».
function VoteDemo({
  variant,
  initialCount,
  initialVoted,
  failNext = false,
}: {
  variant: VoteVariant;
  initialCount: number;
  initialVoted: boolean;
  failNext?: boolean;
}) {
  const [state, setState] = useState({ count: initialCount, voted: initialVoted });
  return (
    <Vote
      variant={variant}
      voteCount={state.count}
      hasVoted={state.voted}
      onToggle={() => {
        if (failNext) return false;
        setState((prev) => ({ count: prev.count + (prev.voted ? -1 : 1), voted: !prev.voted }));
        return true;
      }}
    />
  );
}

const sectionStyle: CSSProperties = {
  marginBottom: 28,
  paddingBottom: 20,
  borderBottom: "1px solid var(--border)",
};

function ArrowBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7m-7 0h7v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4 10a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
