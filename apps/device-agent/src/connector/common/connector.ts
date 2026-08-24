// Общий контракт вендорного коннектора (connector/README.md). Коннектор отвечает за
// ПОДКЛЮЧЕНИЕ к принтеру конкретного вендора (discovery, auth, lifecycle) и на выходе
// отдаёт готовый PrinterDriver — протокольный слой (../driver/printerDriver.ts) о
// вендорной специфике подключения не знает, верхние слои агента — тем более.
//
// Ключевое требование оператора (2026-07-16): если принтер при коннекте просит токен
// или подтверждение (Snapmaker U1 так делает), коннектор ОБЯЗАН пройти через
// OperatorConfirmGate — уведомить оператора в Telegram через бота и дождаться ответа.
// Тихих попыток подключения к железу не бывает.

import type { PrinterDriver } from "../../driver/printerDriver";

/** Вендор коннектора — совпадает с именем папки. */
export type ConnectorVendor = "snapmaker" | "creality" | "flsun";

export interface PrinterEndpoint {
  /** IPv4/hostname принтера в LAN, например "192.168.88.82". */
  host: string;
  /** Порт vendor-API; undefined = дефолт вендора. */
  port?: number;
}

/** Найденный в сети принтер (результат discovery, если вендор его поддерживает). */
export interface DiscoveredPrinter {
  endpoint: PrinterEndpoint;
  vendor: ConnectorVendor;
  /** Модель, как её сообщил принтер (например "Snapmaker U1"), null если не определилась. */
  model: string | null;
  raw: Record<string, unknown>;
}

/**
 * Шлюз подтверждения оператора. Реализация живёт у воркера (TG-бот-мост), коннекторы
 * получают его снаружи и зовут ПЕРЕД любым auth-шагом, требующим человека:
 * послать «пытаюсь подключиться к <vendor> <host>, подтверди на принтере / пришли токен»
 * и ждать. Резолв: {approved:true, token?} — можно продолжать; {approved:false} — стоп.
 */
export interface OperatorConfirmGate {
  requestApproval(input: {
    vendor: ConnectorVendor;
    endpoint: PrinterEndpoint;
    /** Что именно нужно от оператора: подтвердить на экране принтера или прислать токен. */
    reason: "confirm-on-printer" | "token-required";
    /** Человекочитаемый текст для сообщения в Telegram. */
    message: string;
  }): Promise<{ approved: boolean; token?: string }>;
}

export interface ConnectInput {
  endpoint: PrinterEndpoint;
  /** Сохранённый с прошлых сессий токен — если жив, подтверждение не понадобится. */
  savedToken?: string;
  confirmGate: OperatorConfirmGate;
}

export interface ConnectResult {
  ok: boolean;
  driver?: PrinterDriver;
  /** Токен для персиста (переиспользуем в следующих сессиях, не дёргая оператора). */
  token?: string;
  /** Человекочитаемая причина отказа (оператор отклонил / принтер недоступен / auth не прошёл). */
  error?: string;
}

export interface PrinterConnector {
  readonly vendor: ConnectorVendor;
  /** mDNS/SSDP/скан — если вендор поддерживает; иначе метод отсутствует. */
  discover?(subnetHint?: string): Promise<DiscoveredPrinter[]>;
  /** Полный цикл подключения, включая auth через confirmGate. */
  connect(input: ConnectInput): Promise<ConnectResult>;
  disconnect(): Promise<void>;
}
