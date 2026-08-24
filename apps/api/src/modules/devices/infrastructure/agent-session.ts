import { jwtVerify, SignJWT } from "jose";

// Отдельный секрет от JWT_SECRET (auth/session.ts) намеренно: агентские креды — другая
// граница доверия (годовой bearer-токен процесса на чужом железе, не 30-дневная cookie
// живого человека в браузере) — компрометация одного не должна автоматом бить по другому,
// тот же принцип, что и у PLAGID_EXTERNAL_TOKEN_SECRET (auth/plagid.ts) со своим секретом.
function secretKey(): Uint8Array {
  const secret = process.env.AGENT_JWT_SECRET;
  if (!secret) throw new Error("AGENT_JWT_SECRET не задан");
  return new TextEncoder().encode(secret);
}

// ~13 месяцев — креды агента живут долго (MF-795: «постоянные креды сессии»), точечный
// отзыв/ревокация по устройству — MF-423..425 (устройство как недоверенная среда), здесь
// только выпуск начального токена поверх redemption enroll-кода.
// Единый источник TTL для выпуска и HTTP-ответа enroll. 400 дней — ниже годового
// контракта, но достаточно долгий срок для агента; фактический exp всегда приходит
// из JWT, а не вычисляется повторно на стороне вызывающего кода.
export const AGENT_TOKEN_TTL_SECONDS = 400 * 24 * 60 * 60;

export interface AgentCredentialClaims {
  agentId: string;
  ownerId: string;
  deviceId: string;
  role: string;
}

export async function issueAgentCredential(claims: AgentCredentialClaims): Promise<string> {
  return new SignJWT({
    typ: "agent",
    owner_id: claims.ownerId,
    device_id: claims.deviceId,
    role: claims.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.agentId)
    .setIssuedAt()
    .setExpirationTime(`${AGENT_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

export interface VerifiedAgentCredential {
  agentId: string;
  ownerId: string;
  deviceId: string;
  role: string;
}

// Consumer: будущий relay (MF-794) на приёме WS-соединения агента. Строгая проверка typ —
// та же ошибка класса, что уже закрыта в readSession (auth/session.ts): без неё юзерская
// сессионная cookie, попавшая сюда по ошибке, читалась бы как валидный агентский токен.
export async function verifyAgentCredential(token: string): Promise<VerifiedAgentCredential | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ !== "agent") return null;
    if (typeof payload.sub !== "string") return null;
    if (typeof payload.owner_id !== "string") return null;
    if (typeof payload.device_id !== "string") return null;
    if (typeof payload.role !== "string") return null;
    return { agentId: payload.sub, ownerId: payload.owner_id, deviceId: payload.device_id, role: payload.role };
  } catch {
    return null;
  }
}
