import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FocusEvent,
  type InputHTMLAttributes,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import "./ui.css";

/*
  UI-кит (эпик MF-40, сид). Примитивы визуального языка docs/design/readme.md — экраны их
  КОМПОНУЮТ, а не изобретают свои (граница эпика MF-435). Стили — ui.css.
*/

// Стеклянная карточка: градиент + зерно + тонкая обводка (docs/design/components.md § «Форма и стекло»).
export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`uiCard${className ? ` ${className}` : ""}`} style={style}>
      <div className="uiCardGrain" aria-hidden="true" />
      {children}
    </section>
  );
}

// Крупная карточка-действие: заголовок+подпись слева, круглая иконка-аффорданс справа,
// кликабельна целиком (референс: нижний ряд действий; один primary на экран).
// `selected`/`disabled` (MF-903, printer.wizard.md §3.1) — строка-плитка уровня мастера
// «добавить принтер» расширяет этот же примитив вместо нового: data-атрибуты только переключают
// визуал (заливка-морф/приглушение, ui.css), сам checkmark/lock/chevron остаётся за вызывающей
// стороной через `icon` — компонент не решает, какая иконка чему соответствует.
// `role`/`ariaChecked` — passthrough для радио-семантики группы плиток (role="radiogroup" на
// обёртке, каждая строка — role="radio"); необязательны, обычные ActionCard их не задают.
export function ActionCard({
  title,
  sub,
  icon,
  variant = "secondary",
  selected = false,
  disabled = false,
  onClick,
  href,
  onPress,
  onPressEnd,
  role,
  ariaChecked,
  className,
  external = false,
}: {
  title: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  variant?: "primary" | "secondary";
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  // Pass-through пойнтер-хуки (docs/design/motion.md §1/§7, sound.md) — Motion/Sound вешают
  // свою логику на press/release без переписывания разметки экранов.
  onPress?: () => void;
  onPressEnd?: () => void;
  role?: string;
  ariaChecked?: boolean;
  // Раскладка конкретного экрана (напр. плоская строка без зерна/обводки в мастере принтера,
  // printer.wizard.md §3.1) — тот же приём, что className у SelectionTile ниже.
  className?: string;
  // Внешняя ссылка (напр. GitVerse-репо прошивки сообщества, printer.wizard.md §5.2) — не
  // разворачивается внутри портала, открывается в новой вкладке.
  external?: boolean;
}) {
  const inner = (
    <>
      <span>
        <span className="uiActionCardTitle">{title}</span>
        {sub ? <span className="uiActionCardSub" style={{ display: "block" }}>{sub}</span> : null}
      </span>
      <span className="uiActionCardIcon">{icon}</span>
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={`uiActionCard pressable${className ? ` ${className}` : ""}`}
        data-variant={variant}
        data-selected={selected || undefined}
        data-disabled={disabled || undefined}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        role={role}
        aria-checked={ariaChecked}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
        onPointerDown={disabled ? undefined : onPress}
        onPointerUp={disabled ? undefined : onPressEnd}
        onPointerCancel={disabled ? undefined : onPressEnd}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={`uiActionCard pressable${className ? ` ${className}` : ""}`}
      data-variant={variant}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      role={role}
      aria-checked={ariaChecked}
      onPointerDown={disabled ? undefined : onPress}
      onPointerUp={disabled ? undefined : onPressEnd}
      onPointerCancel={disabled ? undefined : onPressEnd}
    >
      {inner}
    </button>
  );
}

// Названия/размеры повторяют матрицу Figma UI-kit «3D портал» (page UI-kit):
// primary/secondary/accent/tertiary/translucent/transparent × l/m/s/xs.
// `ghost` и `danger` остаются совместимыми портал-специфичными вариантами.
export type ControlSize = "l" | "m" | "s" | "xs";
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "tertiary"
  | "translucent"
  | "transparent"
  | "ghost"
  | "danger";

type ButtonCommonProps = {
  variant?: ButtonVariant;
  size?: ControlSize;
  // В Figma иконка опциональна и может стоять с любой стороны. Для обратной совместимости
  // primary по умолчанию ставит переданную иконку справа, остальные варианты — слева.
  // icon={null} и отсутствие пропса дают чистую текстовую кнопку без скрытого аффорданса.
  icon?: ReactNode;
  iconPosition?: "start" | "end";
  children: ReactNode;
  className?: string;
  // Ждём ответ (сабмит формы, авторизация): иконка/аффорданс морфит в спиннер на месте, кнопка
  // не даёт повторный клик (aria-busy + disabled), текст остаётся читаемым — без скачка ширины.
  loading?: boolean;
};

type ButtonAsButton = ButtonCommonProps & { href?: undefined } & Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    keyof ButtonCommonProps
  >;
type ButtonAsAnchor = ButtonCommonProps & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof ButtonCommonProps
  >;

// Кнопка (эпик MF-40 § «Библиотека компонентов»): геометрия и опциональные иконки из
// Figma UI-kit; продуктовая семантика primary/secondary остаётся токенизированной.
// Заменяет локальный PrimaryButton/methodButtonStyle, копипастившиеся в pages/*.
// onPointerDown/onPointerUp/onPointerCancel (docs/design/motion.md §1, sound.md) проходят через
// ...rest как обычные HTML-атрибуты кнопки/ссылки — отдельных onPress/onPressEnd не нужно.
export function Button(props: ButtonAsButton | ButtonAsAnchor) {
  const {
    variant = "primary",
    size = "m",
    icon,
    iconPosition,
    children,
    className,
    loading = false,
    ...rest
  } = props;
  const resolvedIcon = icon ?? null;
  const resolvedIconPosition = iconPosition ?? (variant === "primary" ? "end" : "start");
  const iconSlot = resolvedIcon || loading ? (
    <span className="uiButtonIconPlain" data-loading={loading || undefined}>
      {loading ? <span className="uiButtonSpinner" aria-hidden="true" /> : resolvedIcon}
    </span>
  ) : null;
  const cls = `uiButton pressable${className ? ` ${className}` : ""}`;
  const content =
    resolvedIconPosition === "end" ? (
      <>
        <span>{children}</span>
        {iconSlot}
      </>
    ) : (
      <>
        {iconSlot}
        <span>{children}</span>
      </>
    );

  if ("href" in props && props.href) {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a
        href={href}
        className={cls}
        data-variant={variant}
        data-size={size}
        data-icon-position={iconSlot ? resolvedIconPosition : undefined}
        aria-busy={loading || undefined}
        {...anchorRest}
      >
        {content}
      </a>
    );
  }
  const { type = "button", disabled, ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      type={type}
      className={cls}
      data-variant={variant}
      data-size={size}
      data-icon-position={iconSlot ? resolvedIconPosition : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...buttonRest}
    >
      {content}
    </button>
  );
}

// Однострочное текстовое поле. `controlSize`, в отличие от нативного HTML `size`, меняет
// геометрию контрола и не ограничивает количество символов.
export function Input({
  className,
  controlSize = "m",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { controlSize?: ControlSize }) {
  return <input className={`uiInput${className ? ` ${className}` : ""}`} data-size={controlSize} {...props} />;
}

type FieldChromeProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  controlSize?: ControlSize;
  className?: string;
};

// Подписанное поле из Figma Text Input: label/hint опциональны, error меняет и текст, и
// aria-invalid. Hover/focus/filled отдаются нативному CSS вместо ручного enum-состояния.
export function TextField({
  label,
  hint,
  error,
  leading,
  trailing,
  controlSize = "m",
  className,
  id,
  ...props
}: FieldChromeProps & Omit<InputHTMLAttributes<HTMLInputElement>, "size">) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={`uiField${className ? ` ${className}` : ""}`} data-size={controlSize} data-error={Boolean(error) || undefined}>
      {label ? <label className="uiFieldLabel" htmlFor={inputId}>{label}</label> : null}
      <span className="uiFieldControl">
        {leading ? <span className="uiFieldAdornment" aria-hidden="true">{leading}</span> : null}
        <input
          {...props}
          id={inputId}
          className="uiFieldInput"
          aria-invalid={Boolean(error) || props["aria-invalid"]}
          aria-describedby={[props["aria-describedby"], error || hint ? messageId : null].filter(Boolean).join(" ") || undefined}
        />
        {trailing ? <span className="uiFieldAdornment uiFieldAdornment--trailing" aria-hidden="true">{trailing}</span> : null}
      </span>
      {error || hint ? <span id={messageId} className="uiFieldMessage">{error ?? hint}</span> : null}
    </div>
  );
}

// Большое поле из Figma Big Field: та же оболочка состояний, но textarea свободно растёт
// по высоте и не превращается в отдельный локальный редактор.
export function TextareaField({
  label,
  hint,
  error,
  controlSize = "m",
  className,
  id,
  ...props
}: Omit<FieldChromeProps, "leading" | "trailing"> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={`uiField uiField--big${className ? ` ${className}` : ""}`} data-size={controlSize} data-error={Boolean(error) || undefined}>
      {label ? <label className="uiFieldLabel" htmlFor={inputId}>{label}</label> : null}
      <span className="uiFieldControl">
        <textarea
          {...props}
          id={inputId}
          className="uiFieldInput uiFieldTextarea"
          aria-invalid={Boolean(error) || props["aria-invalid"]}
          aria-describedby={[props["aria-describedby"], error || hint ? messageId : null].filter(Boolean).join(" ") || undefined}
        />
      </span>
      {error || hint ? <span id={messageId} className="uiFieldMessage">{error ?? hint}</span> : null}
    </div>
  );
}

// Нативный select в оболочке Figma Select. Открытие остаётся системным и доступным,
// визуальный chevron — декоративный; сложный multiselect строится отдельной композицией.
export function SelectField({
  label,
  hint,
  error,
  controlSize = "m",
  className,
  id,
  children,
  ...props
}: Omit<FieldChromeProps, "leading" | "trailing"> & SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return (
    <div className={`uiField uiField--select${className ? ` ${className}` : ""}`} data-size={controlSize} data-error={Boolean(error) || undefined}>
      {label ? <label className="uiFieldLabel" htmlFor={inputId}>{label}</label> : null}
      <span className="uiFieldControl">
        <select
          {...props}
          id={inputId}
          className="uiFieldInput uiFieldSelect"
          aria-invalid={Boolean(error) || props["aria-invalid"]}
          aria-describedby={[props["aria-describedby"], error || hint ? messageId : null].filter(Boolean).join(" ") || undefined}
        >
          {children}
        </select>
        <span className="uiFieldSelectChevron" aria-hidden="true">⌄</span>
      </span>
      {error || hint ? <span id={messageId} className="uiFieldMessage">{error ?? hint}</span> : null}
    </div>
  );
}

// Группа полей на одной общей рамке (напр. email: локальная часть + домен) — разделены
// тонкой чертой внутри, а не тремя отдельными боксами (docs/design/components.md).
export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`uiFieldGroup${className ? ` ${className}` : ""}`}>{children}</div>;
}

// Круглая icon-кнопка (back/bell/close) с опциональным бейджем-счётчиком. `wide` — редкий кейс,
// когда кнопка носит подпись рядом с иконкой (feed.post.editor.md §0/§1.1 «← В ленту» на
// cold-start заходе на страницу поста — шире тап-таргета, есть подпись), тач-высота та же,
// ширина авто вместо круга.
export function IconButton({
  label,
  children,
  badge,
  wide,
  variant = "translucent",
  size = "m",
  className,
  onPress,
  onPressEnd,
  type = "button",
  ...props
}: {
  label: string;
  children: ReactNode;
  badge?: number;
  wide?: boolean;
  variant?: Exclude<ButtonVariant, "danger" | "ghost">;
  size?: ControlSize;
  // Pass-through пойнтер-хуки (docs/design/motion.md §1/§7, sound.md) — Motion/Sound вешают
  // свою логику на press/release без переписывания разметки экранов.
  onPress?: () => void;
  onPressEnd?: () => void;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label" | "onPointerDown" | "onPointerUp" | "onPointerCancel"
>) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      className={`uiIconButton pressable${className ? ` ${className}` : ""}`}
      data-variant={variant}
      data-size={size}
      data-wide={wide || undefined}
      onPointerDown={onPress}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
    >
      {children}
      {badge ? <span className="uiIconButtonBadge">{badge > 9 ? "9+" : badge}</span> : null}
    </button>
  );
}

// Пропсы триггера Tooltip, которые он читает/оборачивает — конкретный список вместо
// ReactElement<any> (children — кнопка/иконка-кнопка/т.п., набор хендлеров всегда этот).
interface TooltipTriggerProps {
  "aria-describedby"?: string;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
}

// Единая подсказка для неочевидных контролов: доступное описание остаётся доступным всегда,
// а видимая плашка появляется по hover, keyboard-focus и touch. Она рисуется fixed-слоем ниже
// цели, поэтому не закрывает сам контрол и не меняет раскладку экрана.
export function Tooltip({ content, children }: { content: string; children: ReactElement<TooltipTriggerProps> }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const descriptionId = useId();
  const existingDescription = children.props["aria-describedby"];

  function show(event: FocusEvent<HTMLElement> | MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    setOpen(true);
  }

  const trigger = cloneElement(children, {
    "aria-describedby": [existingDescription, descriptionId].filter(Boolean).join(" "),
    onFocus: (event: FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event);
      show(event);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event);
      setOpen(false);
    },
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      children.props.onMouseEnter?.(event);
      show(event);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      children.props.onMouseLeave?.(event);
      setOpen(false);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      children.props.onPointerDown?.(event);
      if (event.pointerType === "touch") show(event);
    },
  });

  return (
    <>
      {trigger}
      <span id={descriptionId} className="uiTooltipDescription">{content}</span>
      {open ? (
        <span className="uiTooltipBubble" role="tooltip" style={{ top: position.top, left: position.left }}>
          {content}
        </span>
      ) : null}
    </>
  );
}

// Всплывающее меню-панель (GAP-CSS docs/design/model.card.visual.md §6.3): та же формула, что
// приватный Popover капсулы (home/homeheader.tsx `.homePopover`) — вынесена сюда вторым реальным
// применением («⋯»-меню комментария §3.2). Позиционирование — задача вызывающего (обёртка с
// `position: relative` вокруг триггера + этого поповера).
export function Popover({ children, className, align = "end" }: { children: ReactNode; className?: string; align?: "start" | "end" }) {
  return (
    <div className={`uiPopover${align === "start" ? " uiPopover--start" : ""}${className ? ` ${className}` : ""}`} role="menu">
      {children}
    </div>
  );
}

export function PopoverItem({
  children,
  danger,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button type="button" role="menuitem" className={`uiPopoverItem pressable${className ? ` ${className}` : ""}`} data-danger={danger || undefined} {...props}>
      {children}
    </button>
  );
}

export type StatusTone = "ok" | "warn" | "danger" | "dim";

// Уровень интенсивности внутри tone="ok" (docs/design/ideas.md §6, GAP-2): рампа яркости для
// многошаговых жизненных циклов («на рассмотрении»→«готово»), а не только бинарный тон.
export type StatusLevel = 1 | 2 | 3 | 4;

// Голая точка-индикатор без текста (напр. рядом с аватаром/иконкой нава) — тот же тон-набор,
// что и у StatusPill, которая её же и переиспользует внутри себя.
export function StatusDot({
  tone = "dim",
  pulse = false,
  level,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  level?: StatusLevel;
}) {
  return (
    <span
      className="uiStatusDot"
      data-tone={tone}
      data-pulse={pulse || undefined}
      data-level={tone === "ok" ? level : undefined}
      aria-hidden="true"
    />
  );
}

// Статус-пилюля: точка-индикатор + текст; тон кодирует важность («яркость=важность»),
// pulse — только для «требует внимания» (docs/design/status-alerts.md). `level` (только
// tone="ok") — рампа яркости 1..4, `done` — галочка пика яркости (уровень 4, «готово»).
export function StatusPill({
  tone = "dim",
  pulse = false,
  level,
  done = false,
  children,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  level?: StatusLevel;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="uiStatusPill" data-tone={tone} data-pulse={pulse || undefined} data-level={tone === "ok" ? level : undefined}>
      <StatusDot tone={tone} pulse={pulse} level={level} />
      {children}
      {done ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

// Line-иконка «чип» для AgentBadge (readme.md §Иконки: эмодзи в интерфейсных иконках — нет).
function ChipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Агент-бейдж «в работе агентом» (docs/design/feedback.entrypoints.md §7) — прозрачность
// авторства: кто ведёт идею/оставил комментарий, отдельная ось от StatusPill (не тон, не
// важность), поэтому без tone/level — единственный нейтральный вид, не путать со статусом рядом.
export function AgentBadge({ children = "в работе агентом" }: { children?: ReactNode }) {
  return (
    <span className="uiAgentBadge">
      <ChipIcon />
      {children}
    </span>
  );
}

// Line-«искра» — тот же глиф, что AgentBadge/FlagshipBadge (docs/design/printer.face.md §1.2),
// разный контекст (авторство vs. уровень поддержки принтера).
function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2 5 14h6l-1 8 9-13h-7l1-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Бейдж `support_level="custom"` (docs/design/printer.face.md §1.2) — новый вариант пилюли,
// заливка-инверсия (не текст на прозрачности, как StatusPill), line-искра, без пульса (терминал
// жизненного цикла, не тревога). Единственное место, где custom рисуется как готовый продукт —
// вызывающий код обязан сам проверить `firmwareReady`, при false заменить на
// `StatusPill tone="dim"` (§1.2 «модификатор «скоро»»).
export function FlagshipBadge({ children = "Полный портал" }: { children?: ReactNode }) {
  return (
    <span className="uiFlagshipBadge">
      <SparkIcon />
      {children}
    </span>
  );
}

// Чип-подсказка / сегмент-выбор из Figma: выбранность выражена рамкой/мягким фоном и
// aria-pressed. Галочка не дорисовывается примитивом — продукт передаёт её как контент,
// только когда она действительно предусмотрена конкретным сценарием.
export function Chip({
  children,
  selected = false,
  disabled = false,
  size = "m",
  className,
  onClick,
  onPress,
  onPressEnd,
}: {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  size?: ControlSize;
  className?: string;
  onClick?: () => void;
  // Pass-through пойнтер-хуки (docs/design/motion.md §1/§7, sound.md) — Motion/Sound вешают
  // свою логику на press/release без переписывания разметки экранов.
  onPress?: () => void;
  onPressEnd?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`uiChip pressable${className ? ` ${className}` : ""}`}
      data-selected={selected || undefined}
      data-size={size}
      aria-pressed={onClick ? selected : undefined}
      disabled={disabled}
      onPointerDown={onPress}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
    >
      {children}
    </button>
  );
}

// Ряд футер-пилюль карточки контента (docs/design/feed.md §6.2) — 2-3 самостоятельные
// вторично-стеклянные капсулы-действия (иконка+текст/число), каждая перехватывает тап на себе,
// не на общем контейнере (карточка целиком кликабельна — action-пилюли должны её не открывать).
// Визуально тот же примитив, что Chip, но семантика — действие, не toggle: aria-pressed не ставим.
// Первое применение — футер карточки ленты (комментарии/поделиться), переиспользуемо где угодно
// в карточках-контенте с такими же действиями.
export type CardFooterAction = {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
};

export function CardFooterActions({ actions }: { actions: CardFooterAction[] }) {
  return (
    <div className="uiCardFooterActions">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className="uiCardFooterPill pressable"
          onClick={(event) => {
            // Пилюля перехватывает тап — не всплывает до кликабельной карточки (feed.md §2.3/§2.1).
            event.stopPropagation();
            action.onClick();
          }}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}

// Тайл выбора (docs/design/motion.md §1/§7): общий примитив для «крупная карточка/тайл выбора» —
// раньше PersonaCard (home/firstrun.tsx) и AvatarEditor (home/avatareditor.tsx) копипастили одну
// и ту же кнопку с data-selected+pressable по отдельности (эпик MF-40 § не плодить вариации).
// className — вариант раскладки конкретного экрана (homePersonaTile/avedOption/…), поведение общее.
export function SelectionTile({
  selected = false,
  onClick,
  onPress,
  onPressEnd,
  className,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  onPress?: () => void;
  onPressEnd?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`uiSelectionTile pressable${className ? ` ${className}` : ""}`}
      data-selected={selected || undefined}
      onPointerDown={onPress}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
    >
      {children}
    </button>
  );
}

// Двухтоновый Unbounded-заголовок: обычный текст белым, `accent` — мятным.
export function Heading({
  accent,
  after,
  size = "hero",
  children,
}: {
  accent?: ReactNode;
  after?: ReactNode;
  size?: "hero" | "md";
  children?: ReactNode;
}) {
  return (
    <h1 className="uiHeading" data-size={size}>
      {children}
      {accent ? <span className="uiHeadingAccent"> {accent}</span> : null}
      {after ? <> {after}</> : null}
    </h1>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="uiEyebrow">{children}</div>;
}

// Метрика-плитка (docs/design/marketplace.v2.md §6.2 «яркость=важность»): крупное Unbounded-число +
// uppercase-подпись, приглушена по умолчанию (`tone="dim"`) — фон-информация, не действие; тон
// разгорается, когда показатель важен/растёт. Общий примитив — первое применение (статистика
// владельца §6.2) ещё не сверстано, но сетка/тон одни и те же для любого набора метрик-плиток.
export function StatTile({
  label,
  value,
  hint,
  tone = "dim",
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatusTone;
  // Кликабельный вариант (GAP-CSS docs/design/model.card.visual.md §6.1) — оборачиваем в
  // <button>, не меняя визуал: та же плитка, просто интерактивная (напр. «Комментарии»/
  // «Напечатали» на вкладке статистики уводят на соответствующую вкладку).
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="uiStatTileValue">{value}</div>
      <Eyebrow>{label}</Eyebrow>
      {hint ? <div className="uiStatTileHint">{hint}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="uiStatTile uiStatTile--clickable pressable" data-tone={tone} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className="uiStatTile" data-tone={tone}>
      {content}
    </div>
  );
}

export interface ChecklistStep {
  id: string;
  title: string;
  done: boolean;
}

// Виджет чек-листа активации (онбординг-примитив MF-40): прогресс-бар,
// первый шаг уже ✓, один подсвечен «следующий», необязателен.
export function Checklist({
  title,
  steps,
  onStep,
  onDismiss,
}: {
  title: string;
  steps: ChecklistStep[];
  onStep?: (id: string) => void;
  onDismiss?: () => void;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  const nextId = steps.find((step) => !step.done)?.id;
  return (
    <Card className="uiChecklist">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Eyebrow>{title}</Eyebrow>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="pressable"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              fontSize: 13,
              cursor: "pointer",
              minHeight: 48,
              padding: "0 4px",
            }}
          >
            Позже
          </button>
        ) : null}
      </div>
      <div className="uiChecklistBar">
        <div
          className="uiChecklistBarFill"
          style={{ width: `${Math.round((doneCount / Math.max(steps.length, 1)) * 100)}%` }}
        />
      </div>
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          className="uiChecklistItem pressable"
          data-done={step.done || undefined}
          data-next={step.id === nextId || undefined}
          onClick={() => onStep?.(step.id)}
        >
          <span className="uiChecklistMark">{step.done ? "✓" : ""}</span>
          {step.title}
        </button>
      ))}
    </Card>
  );
}

// Coachmark — обучающий слой №3 (бюджет анти-перегруза MF-435/MF-438): точечная подсказка
// у конкретного модуля, ПО ОДНОЙ за раз (вызывающая сторона решает, какую показать —
// компонент не знает о лимите ≤7/жизнь аккаунта, это home/coachmarks.ts). Единственная
// кнопка «Понятно/Позже» (docs эпика — одна кнопка, не крестик): коачмарк не «закрывают
// из вида», а осознанно подтверждают — сам факт клика и есть «не возвращается сама».
export function Coachmark({ title, onDismiss }: { title: string; onDismiss: () => void }) {
  return (
    <div className="uiCoachmark" role="note">
      <span className="uiCoachmarkNub" aria-hidden="true" />
      <span className="uiCoachmarkText">{title}</span>
      <button type="button" className="uiCoachmarkOk pressable" onClick={onDismiss}>
        Понятно / Позже
      </button>
    </div>
  );
}

// Банальный on/off-тумблер (docs/design/push.notifications.md §2.1) — не путать с
// wisp-тумблером темы (theme/wisp.css, отдельный виджет только для темы). Первый потребитель —
// тумблеры пуш-уведомлений в ЛК, второй — мьют-тумблер «Звук» в капсуле шапки (sound.md §0),
// заведён как переиспользуемый примитив сразу, не inline-разметкой под один экран.
// stopPropagation в onClick — Switch часто лежит внутри своей же кликабельной строки
// (вся строка — один жест переключения); без него тап по треку удвоил бы переключение.
export function Switch({
  checked,
  onChange,
  label,
  pending = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={pending}
      data-checked={checked || undefined}
      data-pending={pending || undefined}
      className="uiSwitch"
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
    >
      <span className="uiSwitchTrack" aria-hidden="true">
        <span className="uiSwitchKnob" />
      </span>
    </button>
  );
}

// Принтер-глиф (docs/design/push.notifications.md §2.3): раньше две локальные копии
// (home/firstrun.tsx, market/model.tsx) под один и тот же смысл — components.md §Иконки
// запрещает третью копию под push-строку «Статус принтера», поднято сюда, оба места переведены.
export function PrinterIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 9V4h12v5M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-5A1.5 1.5 0 0 1 4.5 10h15A1.5 1.5 0 0 1 21 11.5v5a1.5 1.5 0 0 1-1.5 1.5H18M6 18v3h12v-3M6 18h12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Куб-глиф «нет превью» (MF-911: было по копии в model.tsx/profile.tsx/market.tsx — тот же
// приём дедупа, что и PrinterIcon выше).
export function CubeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v9m0 9v-9m0 0L4 7.5M12 12l8-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Изображение с независимой прогрессивной подгрузкой (MF-2050): геометрия карточки уже
// существует, пока браузер декодирует картинку. Мягкий shimmer остаётся внутри заданного
// контейнера и растворяется только после `load`, поэтому позднее фото не даёт белой вспышки
// и не перестраивает сетку. Фолбэк показывается честно при пустом src/ошибке, а не маскируется
// вечным skeleton. Применяется карточками проектов/принтеров и LetterboxImage ленты.
export function ProgressiveImage({
  src,
  alt = "",
  className,
  imageClassName,
  loading = "lazy",
  fallback,
  onError,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  imageClassName?: string;
  loading?: "eager" | "lazy";
  fallback?: ReactNode;
  onError?: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [src]);

  const state = !src ? "empty" : failed ? "error" : ready ? "ready" : "loading";

  return (
    <div
      className={`uiProgressiveMedia${className ? ` ${className}` : ""}`}
      data-state={state}
      aria-busy={state === "loading" || undefined}
    >
      {state === "loading" ? <span className="uiProgressiveMediaSkeleton" aria-hidden="true" /> : null}
      {src && !failed ? (
        <img
          className={`uiProgressiveMediaImg${imageClassName ? ` ${imageClassName}` : ""}`}
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          onLoad={() => setReady(true)}
          onError={() => {
            setFailed(true);
            onError?.();
          }}
        />
      ) : fallback ?? null}
    </div>
  );
}

// Летбокс-блюр (docs/design/feed.md §2.2/§6.3, MF-962): контейнер медиа/превью с фикс.
// пропорциями, где фактическое изображение уже рамки — фон под кадром не заливка токеном,
// а блёрнутая копия того же изображения (`blur(24px) brightness(.55) scale(1.15)`), чтобы
// кадр «расширялся в себя» вместо серых полей. Первое применение — обложка media-поста и
// превью model_link (feed/postcard.tsx); переиспользуй здесь, а не копируй приём заново —
// эпик-принцип «повторилось дважды → фиксируем систему» уже сработал один раз (§6.3).
export function LetterboxImage({
  src,
  alt = "",
  className,
  style,
  children,
  onClick,
  role,
  tabIndex,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  // Оверлеи поверх кадра (play-иконка, градиент-сниппет и т.п.) — вызывающая сторона
  // решает, что рисовать, компонент только держит слои блюр-фона/чёткого изображения.
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  // Passthrough для кликабельного превью (напр. переход к модели) — та же кнопочная семантика,
  // что onPress/role у ActionCard выше, компонент не решает это за вызывающую сторону.
  role?: string;
  tabIndex?: number;
}) {
  return (
    <div
      className={`uiLetterbox${className ? ` ${className}` : ""}`}
      style={style}
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
    >
      {src ? (
        <>
          <div className="uiLetterboxBg" style={{ backgroundImage: `url(${src})` }} aria-hidden="true" />
          <ProgressiveImage className="uiLetterboxMedia" imageClassName="uiLetterboxFg" src={src} alt={alt} />
        </>
      ) : null}
      {children}
    </div>
  );
}

// Empty-state — пассивный обучающий слой №1 (бюджет анти-перегруза MF-435).
export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="uiEmptyState">
      <div className="uiEmptyStateIcon">{icon}</div>
      <div style={{ color: "var(--text)", fontSize: 16 }}>{title}</div>
      {sub ? <div style={{ fontSize: 14 }}>{sub}</div> : null}
      {action}
    </div>
  );
}
