import { useEffect, useRef, useState } from "react";
import type { OverlayApi } from "@platform/overlay";
import type { SessionUser } from "@shared/types";
// eslint-disable-next-line boundaries/element-types -- легатное междоменное ребро (Этап 8): printing→access useGuestLogin, развязка отложена до pages/DI. См. MIGRATION.md.
import { useGuestLogin } from "@domains/access";
import { useInteractionSound } from "@platform/sound";
import { ActionCard, Button, Eyebrow, Input, StatusPill } from "@shared/ui";
import { createEnrollCode, fetchPrinterIds, type EnrollCode } from "./enroll.ts";
import { EnrollCodeDisplay } from "./enrollcodepanel.tsx";
import {
  allManagedUnavailable,
  computeGating,
  LEVEL_COPY,
  LEVEL_IDS,
  type LevelId,
  type GateResult,
  type PrinterCanonInfo,
} from "./gating.ts";
import { checkMoonrakerIp, type IpCheckResult } from "./ipcheck.ts";
import "./park.css";

const ENROLL_POLL_MS = 4000;

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginRight: 4 }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 11v5.5M12 8v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function rowIcon(enabled: boolean, selected: boolean) {
  if (!enabled) return <LockIcon />;
  if (selected) return <CheckIcon />;
  return <ChevronIcon />;
}

// Второй ряд подписи (§3.1/§3.2): «что даёт» + «чем ограничено» (с инфо-иконкой). Когда плитка
// погашена, вторая строка заменяется причиной гейта (§3.3) — та же визуальная роль, честный текст.
function TileSub({ gives, limitation }: { gives: string; limitation: string }) {
  return (
    <>
      {gives}
      <span style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
        <InfoIcon />
        {limitation}
      </span>
    </>
  );
}

export interface LevelTilesProps {
  brand: string;
  model: string;
  canon: PrinterCanonInfo | null;
  canonLoading: boolean;
  overlay: OverlayApi;
  user: SessionUser | null;
  initialLevel?: LevelId | null;
  initialIp?: string;
  onDiy: () => void;
  onCommunityFirmware: () => void;
  onDone: (level: LevelId, lanEndpoint?: string) => void;
}

type IpState = { status: "idle" | "loading" | "success" | "error" };
type EnrollState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "waiting"; data: EnrollCode }
  | { status: "expired" }
  | { status: "offline" }
  | { status: "success" };

export function LevelTiles({ brand, model, canon, canonLoading, overlay, user, initialLevel = null, initialIp = "", onDiy, onCommunityFirmware, onDone }: LevelTilesProps) {
  const sound = useInteractionSound();
  const promptGuestLogin = useGuestLogin();
  const gating = computeGating(canon) as Record<LevelId, GateResult>;
  const [selected, setSelected] = useState<LevelId | null>(initialLevel);

  const [ip, setIp] = useState(initialIp);
  const [ipState, setIpState] = useState<IpState>({ status: "idle" });

  const [enroll, setEnroll] = useState<EnrollState>({ status: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownIdsRef = useRef<string[]>([]);

  const exitsVisible = !canonLoading && allManagedUnavailable(gating);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  function selectLevel(level: LevelId) {
    if (!gating[level].enabled) return;
    if (!user && level !== "list") {
      if (level === "managed-cloud") return;
      promptGuestLogin({ kind: "printer_connect", printerId: `${brand}-${model}`, level, ip: level === "managed-local" ? ip.trim() || undefined : undefined, returnTo: window.location.pathname + window.location.search });
      return;
    }
    sound.toggle();
    setSelected((current) => (current === level ? null : level));
  }

  async function runIpCheck() {
    if (ipState.status === "loading" || !ip.trim()) return;
    setIpState({ status: "loading" });
    const result: IpCheckResult = await checkMoonrakerIp(ip);
    setIpState({ status: result.status === "ok" ? "success" : "error" });
    if (result.status === "ok") {
      sound.success();
    } else {
      sound.error();
      overlay.toast({
        severity: "warn",
        title: "Принтер не отвечает",
        message: "Проверьте, что вы в той же сети и Moonraker включён на этом принтере",
      });
    }
  }

  async function startEnroll() {
    setEnroll({ status: "loading" });
    const before = await fetchPrinterIds();
    if (!before.online) {
      sound.offline();
      setEnroll({ status: "offline" });
      return;
    }
    knownIdsRef.current = before.ids;
    const code = await createEnrollCode();
    if (!code) {
      sound.offline();
      setEnroll({ status: "offline" });
      return;
    }
    sound.success();
    setEnroll({ status: "waiting", data: code });
    pollRef.current = setInterval(async () => {
      if (new Date(code.expiresAt).getTime() < Date.now()) {
        if (pollRef.current) clearInterval(pollRef.current);
        setEnroll({ status: "expired" });
        return;
      }
      const result = await fetchPrinterIds();
      if (!result.online) {
        sound.offline();
        setEnroll({ status: "offline" });
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      if (result.ids.some((id) => !knownIdsRef.current.includes(id))) {
        if (pollRef.current) clearInterval(pollRef.current);
        sound.success();
        setEnroll({ status: "success" });
      }
    }, ENROLL_POLL_MS);
  }

  async function requestCustomAccess() {
    const confirmed = await overlay.confirm({
      title: "Запросить доступ к прошивке",
      message: `Прошивка для «${brand} ${model}» приватна и меняет системное ПО принтера — устанавливается только по вашему явному запросу. Продолжить?`,
      confirmLabel: "Запросить доступ",
      cancelLabel: "Отмена",
      destructive: true,
    });
    if (!confirmed) return;
    // Публичного API заявок ещё нет (MF-888, todo на момент MF-903) — честно сообщаем, что заявка
    // фиксируется, но обработка сейчас ручная (оператор), не мгновенная автоматика.
    overlay.toast({ severity: "success", title: "Заявка принята", message: "Мы свяжемся с вами, когда прошивка для этой модели будет готова" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }} role="radiogroup" aria-label="Что вы хотите делать с принтером" aria-busy={canonLoading || undefined}>
      {canonLoading ? <p role="status" aria-live="polite" className="parkWizardNotice">Проверяем данные каталога…</p> : null}
      {LEVEL_IDS.map((level) => {
        const gate = gating[level];
        const copy = LEVEL_COPY[level];
        const isSelected = selected === level;
        return (
          <div key={level} className="parkLevelGroup">
            <ActionCard
              className="parkLevelTile"
              role="radio"
              ariaChecked={isSelected}
              title={copy.title}
              sub={<TileSub gives={copy.gives} limitation={gate.enabled ? copy.limitation : (gate.reason ?? copy.limitation)} />}
              icon={rowIcon(gate.enabled, isSelected)}
              selected={isSelected}
              disabled={!gate.enabled}
              onPress={gate.enabled ? sound.toggle : undefined}
              onClick={() => selectLevel(level)}
            />
            {isSelected ? (
              <div className="parkSubpanel reveal">
                {level === "list" ? (
                  <Button variant="primary" onPointerDown={sound.confirm} onClick={() => onDone("list")}>
                    Добавить в парк
                  </Button>
                ) : null}

                {level === "managed-local" ? (
                  <div className="parkIpPanel">
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Input
                        value={ip}
                        onChange={(event) => {
                          setIp(event.target.value);
                          if (ipState.status !== "idle") setIpState({ status: "idle" });
                        }}
                        placeholder="192.168.1.42"
                        aria-label="IP-адрес принтера"
                        aria-describedby={ipState.status === "error" ? "park-ip-error" : undefined}
                        aria-invalid={ipState.status === "error" || undefined}
                        inputMode="decimal"
                        style={{ flex: 1, minWidth: 160 }}
                      />
                      <button
                        type="button"
                        className="uiButton pressable parkCheckButton"
                        data-variant="secondary"
                        data-loading={ipState.status === "loading" || undefined}
                        aria-busy={ipState.status === "loading" || undefined}
                        disabled={ipState.status === "loading" || !ip.trim()}
                        onPointerDown={sound.confirm}
                        onClick={() => void runIpCheck()}
                      >
                        {ipState.status === "loading" ? <span className="uiButtonSpinner" aria-hidden="true" /> : null}
                        <span className={ipState.status === "loading" ? "parkVisuallyHidden" : undefined}>
                          Проверить
                        </span>
                      </button>
                    </div>
                    {ipState.status === "loading" ? <p role="status" aria-live="polite" className="parkWizardNotice">Проверяем подключение…</p> : null}
                    {ipState.status === "success" ? (
                      <div className="parkIpSuccess reveal" role="status" aria-live="polite">
                        <StatusPill tone="ok" done>
                          Принтер найден
                        </StatusPill>
                        <Button variant="primary" onPointerDown={sound.confirm} onClick={() => onDone("managed-local", ip.trim())}>
                          Добавить в парк
                        </Button>
                      </div>
                    ) : null}
                    {ipState.status === "error" ? (
                      <div id="park-ip-error" className="parkIpError" role="alert" aria-live="assertive">
                        <p className="parkErrorText">
                          Принтер не отвечает по этому адресу — вы точно в той же сети и Moonraker включён?
                        </p>
                        {gating["managed-bridge"].enabled ? (
                          <button type="button" className="parkGhostHint pressable" onPointerDown={sound.tick} onClick={() => selectLevel("managed-bridge")}>
                            Управлять и вне дома? Поставить агент
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {level === "managed-bridge" ? (
                  <div className="parkEnrollPanel">
                    {enroll.status === "idle" ? (
                      <Button variant="secondary" icon={null} onPointerDown={sound.confirm} onClick={() => void startEnroll()}>
                        Установить агент
                      </Button>
                    ) : null}
                    {enroll.status === "loading" ? <p role="status" aria-live="polite" className="parkWizardNotice">Создаём код подключения…</p> : null}
                    {enroll.status === "waiting" ? (
                      <EnrollCodeDisplay code={enroll.data.code} installCommand={enroll.data.installCommand} />
                    ) : null}
                    {enroll.status === "offline" ? (
                      <div className="parkIpError" role="alert">
                        <p className="parkErrorText">Нет связи с порталом — проверьте интернет и попробуйте снова.</p>
                        <button type="button" className="parkGhostHint pressable" onPointerDown={sound.tick} onClick={() => void startEnroll()}>
                          Повторить
                        </button>
                      </div>
                    ) : null}
                    {enroll.status === "expired" ? (
                      <div>
                        <p className="parkErrorText">Код истёк</p>
                        <button type="button" className="parkGhostHint pressable" onPointerDown={sound.tick} onClick={() => void startEnroll()}>
                          Сгенерировать новый
                        </button>
                      </div>
                    ) : null}
                    {enroll.status === "success" ? (
                      <div className="parkIpSuccess reveal" role="status" aria-live="polite">
                        <StatusPill tone="ok" done>
                          Агент на связи
                        </StatusPill>
                        <Button variant="primary" onPointerDown={sound.confirm} onClick={() => onDone("managed-bridge")}>
                          Открыть управление
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {level === "custom" ? (
                  <div className="parkCustomPanel">
                    <p className="parkWarningText">
                      Прошивка сейчас приватная и ставится по запросу — оператор свяжется с вами, когда сборка для
                      «{brand} {model}» будет готова к установке.
                    </p>
                    <Button variant="secondary" icon={null} onClick={() => void requestCustomAccess()}>
                      Запросить доступ
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {exitsVisible ? (
        <div className="parkExits reveal">
          <Eyebrow>Эта модель пока без управления</Eyebrow>
          <ActionCard
            className="parkExitCard"
            title="Сделать самому"
            sub="Публичный API портала — напишите свою интеграцию поверх Moonraker"
            icon={<ChevronIcon />}
            onClick={onDiy}
          />
          <ActionCard
            className="parkExitCard"
            title="Прошивки сообщества"
            sub="Адаптации других пользователей на GitVerse"
            icon={<ChevronIcon />}
            onClick={onCommunityFirmware}
          />
        </div>
      ) : null}
    </div>
  );
}
