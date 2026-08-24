// MF-2071. Опознание принтера по фактам, снятым с устройства в локальной сети, и рецепт
// коннекта для нативного клиента (репозиторий UltraDevice).
//
// Правила живут здесь, а не в приложении, сознательно. Приложение уходит в App Store и
// обновляется неделями; новое семейство принтеров или изменившийся вендорский признак не должны
// этого ждать. Клиент присылает то, что ему сказало устройство, — решение принимает сервер.
//
// Чего здесь намеренно нет: серийного номера. Устройство отдаёт его в `product_info`, но для
// ответа «что это за модель» он не нужен, а хранить и возить идентификатор конкретного
// экземпляра ради косметики — лишний риск. Модель опознаётся типом, не экземпляром.

/** Что клиент снял с устройства. Все поля необязательны: набор зависит от прошивки. */
export interface DeviceFacts {
  /** `machine/system_info` → `product_info.machine_type`. Самый сильный признак: устройство
   *  называет себя само. У ванильного Klipper этого поля нет вовсе. */
  machine_type?: string;
  /** `product_info.device_name` — короткое имя модели («U1»). */
  device_name?: string;
  /** `printer/info` → `hostname`. Часто внутреннее кодовое имя прошивки, а не модель. */
  hostname?: string;
  software_version?: string;
  klipper_path?: string;
  config_file?: string;
  log_file?: string;
  /** Дистрибутив из `machine/system_info.distribution.id` — вендорские сборки на Buildroot. */
  distribution?: string;
  /** `printer/objects/list`. По ним видно вендорские макросы и число экструдеров. */
  objects?: string[];
  /** `toolhead.axis_maximum` минус `axis_minimum`, мм. */
  build_volume_mm?: { x: number; y: number; z: number };
  nozzle_diameter_mm?: number[];
}

export interface CatalogPrinter {
  id: string;
  slug: string;
  brand: string;
  model: string;
  aliases: string[];
  kinematics: string | null;
  build_volume_x: string | null;
  build_volume_y: string | null;
  build_volume_z: string | null;
  moonraker: boolean | null;
  lan_mode: boolean | null;
  status: string | null;
}

export type Confidence = "high" | "medium";

export interface IdentityMatch {
  printer_id: string;
  slug: string;
  brand: string;
  model: string;
  kinematics: string | null;
  catalog_build_volume_mm: { x: number; y: number; z: number } | null;
  confidence: Confidence;
  /** По каким именно признакам сошлось — чтобы клиент мог показать это человеку, а не
   *  предъявлять безосновательный вердикт. */
  matched_by: string[];
}

/** Что удалось вычитать из фактов независимо от того, нашлась ли модель в каталоге. */
export interface DeviceSignals {
  vendor: string | null;
  extruders: number | null;
  macro_prefixes: string[];
}

export interface IdentityResult {
  match: IdentityMatch | null;
  signals: DeviceSignals;
}

/** Приводит человеческое название к сравнимому виду: регистр, пунктуация, кратные пробелы. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Префикс вендорских макросов Klipper → бренд. Вендоры, ставящие Klipper на свои принтеры,
// добавляют собственные макросы с узнаваемым префиксом — это остаётся видно даже когда
// `product_info` в прошивке нет.
//
// Snapmaker: `gcode_macro SM_PRINT_*` — проверено на живом U1 (192.168.88.82), см.
// apps/device-agent/src/connector/snapmaker/README.md.
const MACRO_VENDORS: ReadonlyArray<{ prefix: string; brand: string }> = [
  { prefix: "SM_", brand: "Snapmaker" },
  { prefix: "CX_", brand: "Creality" },
  { prefix: "QIDI_", brand: "QIDI Tech" },
  { prefix: "ELEGOO_", brand: "ELEGOO" },
];

// Кодовые имена прошивок: `hostname` вендорской сборки — это не модель, а внутреннее имя.
// Признак слабый сам по себе, поэтому даёт только `medium` и только вместе с брендом.
const HOSTNAME_CODENAMES: Readonly<Record<string, string>> = {
  lava: "Snapmaker U1",
};

export function readSignals(facts: DeviceFacts): DeviceSignals {
  const objects = facts.objects ?? [];

  const prefixes = new Set<string>();
  for (const object of objects) {
    const macro = /^gcode_macro\s+([A-Z][A-Z0-9]*_)/.exec(object);
    if (macro?.[1]) prefixes.add(macro[1]);
  }

  const vendorByMacro = MACRO_VENDORS.find(({ prefix }) => prefixes.has(prefix))?.brand ?? null;
  const vendorByPath = /\/home\/(lava)\//.exec(facts.klipper_path ?? "") ? "Snapmaker" : null;

  // Экструдеры считаем по объектам `extruder`, `extruder1`… — это то, как их нумерует Klipper.
  const extruders = objects.filter((object) => /^extruder\d*$/.test(object)).length;

  return {
    vendor: vendorByMacro ?? vendorByPath,
    extruders: extruders > 0 ? extruders : (facts.nozzle_diameter_mm?.length ?? null),
    macro_prefixes: [...prefixes].sort(),
  };
}

function catalogVolume(printer: CatalogPrinter): { x: number; y: number; z: number } | null {
  const x = Number(printer.build_volume_x);
  const y = Number(printer.build_volume_y);
  const z = Number(printer.build_volume_z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (x <= 0 || y <= 0 || z <= 0) return null;
  return { x, y, z };
}

function toMatch(printer: CatalogPrinter, confidence: Confidence, matchedBy: string[]): IdentityMatch {
  return {
    printer_id: printer.id,
    slug: printer.slug,
    brand: printer.brand,
    model: printer.model,
    kinematics: printer.kinematics,
    catalog_build_volume_mm: catalogVolume(printer),
    confidence,
    matched_by: matchedBy,
  };
}

/** Все написания, под которыми каталожная запись может встретиться в ответе устройства. */
function namesOf(printer: CatalogPrinter): string[] {
  return [`${printer.brand} ${printer.model}`, printer.model, printer.slug.replace(/[.]/g, " "), ...printer.aliases].map(normalize).filter((name) => name.length > 0);
}

/**
 * Сопоставляет факты устройства с каталогом.
 *
 * Порядок попыток — от прямого утверждения устройства к косвенным признакам. Ни один шаг не
 * угадывает: если ничего не сошлось, возвращается `null`. Показать пользователю чужую модель
 * хуже, чем не показать никакой — он на неё нарежет и напечатает.
 */
export function identify(facts: DeviceFacts, catalog: CatalogPrinter[]): IdentityResult {
  const signals = readSignals(facts);

  // 1. Устройство назвало себя. `machine_type` вендорских прошивок содержит полное имя
  //    («Snapmaker U1»), поэтому сравниваем с брендом+моделью и псевдонимами каталога.
  const declared = normalize(facts.machine_type ?? "");
  if (declared) {
    const exact = catalog.find((printer) => namesOf(printer).includes(declared));
    if (exact) return { match: toMatch(exact, "high", ["machine_type"]), signals };

    // Устройство может назваться подробнее каталога («Snapmaker U1 Pro» против «U1»).
    // Принимаем только вхождение бренда И модели — иначе «U1» совпадёт с чем угодно.
    const contained = catalog.find((printer) => {
      const brand = normalize(printer.brand);
      const model = normalize(printer.model);
      return brand.length > 0 && model.length > 0 && declared.includes(brand) && declared.includes(model);
    });
    if (contained) return { match: toMatch(contained, "high", ["machine_type"]), signals };
  }

  // 2. Короткое имя модели вместе с брендом, вычисленным по вендорским признакам. Само по себе
  //    `device_name` («U1») слишком бедное, чтобы решать: моделей с таким именем может быть
  //    несколько у разных вендоров.
  const deviceName = normalize(facts.device_name ?? "");
  if (deviceName && signals.vendor) {
    const vendor = normalize(signals.vendor);
    const byVendor = catalog.find((printer) => normalize(printer.brand) === vendor && namesOf(printer).includes(deviceName));
    if (byVendor) return { match: toMatch(byVendor, "high", ["device_name", "vendor_macros"]), signals };
  }

  // 3. Кодовое имя прошивки. Слабее предыдущих: это догадка по внутреннему имени, поэтому
  //    `medium` — клиент обязан показать её как предположение.
  const codename = HOSTNAME_CODENAMES[normalize(facts.hostname ?? "")];
  if (codename) {
    const target = normalize(codename);
    const byCodename = catalog.find((printer) => namesOf(printer).includes(target));
    if (byCodename) return { match: toMatch(byCodename, "medium", ["hostname_codename"]), signals };
  }

  // 4. Бренд известен по макросам, и у него в каталоге ровно одна запись, чья рабочая область
  //    сходится с измеренной. Если записей несколько — не выбираем наугад.
  if (signals.vendor && facts.build_volume_mm) {
    const vendor = normalize(signals.vendor);
    const measured = facts.build_volume_mm;
    const candidates = catalog.filter((printer) => {
      if (normalize(printer.brand) !== vendor) return false;
      const volume = catalogVolume(printer);
      if (!volume) return false;
      // Допуск 15%: каталог хранит маркетинговую рабочую область, а устройство — пределы
      // ходов осей. У U1 это 270³ против 271x335x281 — механика тул-чейнджера выезжает за
      // печатное поле, и совпадения «в точку» здесь не бывает никогда.
      return (["x", "y", "z"] as const).every((axis) => Math.abs(volume[axis] - measured[axis]) <= volume[axis] * 0.15 + 25);
    });
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only) return { match: toMatch(only, "medium", ["vendor_macros", "build_volume"]), signals };
  }

  return { match: null, signals };
}

/**
 * Как выглядит привязка у конкретного семейства принтеров.
 *
 * Словарь `reason` общий с коннектором агента (`apps/device-agent/src/connector/common/
 * connector.ts`) — там же зафиксировано требование оператора от 16 июля 2026: если принтер при
 * подключении просит токен или подтверждение, тихо подключаться нельзя. В приложении роль
 * гейта играет сам человек: он держит принтер в руках.
 *
 * Обязательность шага решает не этот рецепт, а само устройство: Moonraker отвечает на
 * `/access/info` полями `login_required` и `trusted`. Рецепт говорит, ЧТО просить и ГДЕ это
 * взять на конкретной модели; принтер говорит, НУЖНО ли это сейчас. Показывать обязательный
 * ввод там, где принтер пускает без него, значило бы изображать проверку.
 */
export interface EnrollmentStep {
  /** Бренд каталога или `*` — правило по умолчанию. */
  brand: string;
  reason: "confirm-on-printer" | "token-required" | "not-required";
  title: string;
  instructions: string;
  code: {
    label: string;
    /** Где именно этот код взять — у каждой модели своё меню. */
    hint: string;
    keyboard: "default" | "number";
  } | null;
  /** Как предъявлять полученный код принтеру. */
  present_as: "x-api-key";
}

// У Snapmaker U1 код с экрана существует, но принадлежит ДРУГОМУ каналу, и подставлять его
// как ключ Moonraker нельзя — он там не сработает.
//
// Разобрано по исходникам самого вендора (github.com/Snapmaker/OrcaSlicer,
// `src/slic3r/Utils/MoonRaker.cpp`, класс `Moonraker_Mqtt`) и проверено на живом станке
// 3 августа 2026:
//
//   1. Слайсер соединяется с MQTT-брокером принтера открытым `mqtt://`.
//   2. Подписывается на `<код>/config/response`, публикует в `<код>/config/request`
//      `{"jsonrpc":"2.0","method":"server.request_key","params":{"clientid":"<локальный IP>"}}`.
//   3. Принтер отвечает `{state, sn, clientid, ca, cert, key, port}` — то есть выдаёт клиентский
//      TLS-сертификат.
//   4. Дальше слайсер переподключается уже `mqtts://` на выданный порт с этим сертификатом.
//
// То есть код с экрана — это одноразовый пропуск за клиентским сертификатом, а не пароль,
// который куда-то подставляют в заголовок. На станке проверено: 8883 отвечает TLS 1.3 с
// сертификатом `CN=mqtt_server, O=snapmaker.com`, выпущенным `CN=mqtt-broker`; 1883 закрыт,
// открытый брокер принтер поднимает только на время сопряжения.
//
// Нам этот канал сегодня не нужен: печать идёт по HTTP-API Moonraker, который тот же станок
// отдаёт на 7125 и 80 без ключа для доверенной локальной сети. Поэтому шаг честно говорит,
// что вводить нечего, и объясняет, чем является код на экране, — вместо того чтобы просить
// его и получить отказ.
const ENROLLMENT: readonly EnrollmentStep[] = [
  {
    brand: "Snapmaker",
    reason: "not-required",
    title: "Вводить ничего не нужно",
    instructions:
      "Код, который Snapmaker показывает на экране при подключении из слайсера, — пропуск " +
      "к отдельному каналу управления по MQTT. Печать идёт другим путём, который принтер " +
      "открывает устройствам локальной сети без кода.",
    code: null,
    present_as: "x-api-key",
  },
  {
    brand: "*",
    reason: "token-required",
    title: "Ключ доступа Moonraker",
    instructions: "Если принтер закрыт ключом, его показывает веб-морда принтера (Fluidd или Mainsail) " + "в настройках, раздел «API keys».",
    code: { label: "Ключ доступа", hint: "Веб-морда принтера → Settings → API keys", keyboard: "default" },
    present_as: "x-api-key",
  },
];

/** Правило для бренда, иначе общее. Точное совпадение по бренду каталога, без догадок. */
export function enrollmentFor(brand: string | null | undefined): EnrollmentStep {
  const target = normalize(brand ?? "");
  const byBrand = target ? ENROLLMENT.find((step) => normalize(step.brand) === target) : undefined;
  return byBrand ?? ENROLLMENT[ENROLLMENT.length - 1]!;
}

/**
 * Рецепт коннекта: где искать принтеры и что у них спрашивать.
 *
 * Порты не выдуманы — это то, что реально отвечает: 7125 у самого Moonraker, 80 у веб-морды
 * (nginx проксирует те же пути), 4408 у части вендорских сборок. Проверено на живом Snapmaker
 * U1: `:7125` и `:80` отдают идентичный JSON на `/printer/info`
 * (apps/device-agent/src/connector/snapmaker/README.md).
 */
export function connectRecipe() {
  return {
    version: 1,
    protocols: [
      {
        id: "moonraker",
        ports: [7125, 80, 4408],
        /** Чем проверяем, что по адресу принтер, а не произвольный веб-сервер. */
        identity_path: "/printer/info",
        /** Откуда брать `product_info` — модель, прошивку, диаметры сопел. */
        system_info_path: "/machine/system_info",
        /** Список объектов Klipper: вендорские макросы и число экструдеров. */
        objects_path: "/printer/objects/list",
        /** Пределы осей для рабочей области. */
        toolhead_path: "/printer/objects/query?toolhead",
        upload_path: "/server/files/upload",
        start_path: "/printer/print/start",
        /** Обход подсети: короткий таймаут и умеренная параллельность, иначе слабый
         *  контроллер принтера начинает отвечать медленнее, чем без нагрузки. */
        probe_timeout_ms: 1500,
        probe_concurrency: 24,
      },
    ],
    /** Шире этого префикса подсеть не обходим: /16 — это 65 тысяч адресов. */
    min_prefix_length: 22,
    /** Чем проверяем, требует ли этот принтер ключ прямо сейчас. */
    access_path: "/access/info",
    enrollment: ENROLLMENT,
  };
}
