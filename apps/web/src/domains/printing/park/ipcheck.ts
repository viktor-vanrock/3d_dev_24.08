// Проверка IP (managed-local, printer.wizard.md §4/§3.4) — проба идёт ИЗ БРАУЗЕРА, не с сервера
// (docs/epics/printer.support.md «Контролы»: это и есть защита от SSRF — сервер не должен ходить
// по чужим локальным адресам). Бьём напрямую в Moonraker HTTP API (стандартный порт 7125,
// `GET /printer/info` — есть на любом Klipper+Moonraker без авторизации по умолчанию).
//
// Известное ограничение (не решается этой карточкой): 3mf.tech отдаётся по HTTPS, а Moonraker в
// локалке — обычно голый HTTP; современные браузеры блокируют такой запрос как mixed content на
// части конфигураций сети/Chrome-политик private-network-access. Это тот же компромисс, о котором
// прямо говорит architecture/printer.server.md §1 (браузер↔принтер напрямую, только в одной сети)
// — если браузер блокирует сам запрос, проверка честно упадёт в состояние "error" ниже, тот же
// текст, что и обычный «принтер не отвечает».

export type IpCheckResult = { status: "ok"; endpoint: string } | { status: "error" };

const MOONRAKER_PORT = 7125;
const TIMEOUT_MS = 5000;

function isPrivateIpv6(host: string): boolean {
  const sections = host.split("::");
  if (sections.length > 2) return false;

  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false;
  if (sections.length === 1 ? groups.length !== 8 : groups.length >= 8) return false;

  const firstGroup = left[0] ?? "0";
  const first = Number.parseInt(firstGroup, 16);
  return (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf);
}

function allowedHost(input: string): { endpointHost: string } | null {
  const value = input.trim();
  if (!value || /[/?#@\s]/.test(value)) return null;
  const bracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : null;
  const host = bracketed ?? value;
  if (bracketed !== null) {
    if (!isPrivateIpv6(host)) return null;
    return { endpointHost: `[${host}]` };
  }
  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const values = octets.map(Number);
  if (values.some((value) => value > 255)) return null;
  const [a, b] = values;
  if (a === undefined || b === undefined || !(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return null;
  return { endpointHost: host };
}

export async function checkMoonrakerIp(ip: string): Promise<IpCheckResult> {
  const parsed = allowedHost(ip);
  if (!parsed) return { status: "error" };
  const { endpointHost } = parsed;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`http://${endpointHost}:${MOONRAKER_PORT}/printer/info`, { signal: controller.signal, redirect: "error" });
    if (!response.ok) return { status: "error" };
    const data = (await response.json()) as Record<string, unknown>;
    return "result" in data ? { status: "ok", endpoint: `${endpointHost}:${MOONRAKER_PORT}` } : { status: "error" };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}
