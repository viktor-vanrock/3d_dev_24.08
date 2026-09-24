import { useEffect, useState } from "react";
import { apiFetch } from "@shared/api";
import { Button } from "@shared/ui";
import { navigate } from "../../router.ts";
import styles from "./sessions-list.module.css";

interface Session { id: string; created_at: string; isCurrent: boolean }

export function SessionsList() {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [error, setError] = useState("");
  async function load() {
    const response = await apiFetch("/auth/sessions", { credentials: "include" });
    const data = await response.json().catch(() => ({})) as { sessions?: readonly Session[] };
    if (!response.ok) return setError("Не удалось загрузить сеансы.");
    setSessions(data.sessions ?? []);
  }
  useEffect(() => { void load(); }, []);
  async function end(id: string) { await apiFetch(`/auth/sessions/${id}`, { method: "DELETE", credentials: "include" }); await load(); }
  async function endOthers() { await apiFetch("/auth/sessions", { method: "DELETE", credentials: "include" }); navigate("/login", "back"); window.location.reload(); }
  return <section className={styles.section}>
    <h3>Активные сеансы</h3>
    <div className={styles.list}>{sessions.map((session) => <div className={styles.row} key={session.id}>
      <span>{new Date(session.created_at).toLocaleString("ru-RU")} {session.isCurrent && <span className={styles.current}>(это вы)</span>}</span>
      {!session.isCurrent && <Button type="button" variant="secondary" onClick={() => void end(session.id)}>Завершить</Button>}
    </div>)}</div>
    {error && <p className={styles.error}>{error}</p>}
    <Button type="button" variant="secondary" onClick={() => void endOthers()} disabled={!sessions.some((session) => !session.isCurrent)}>Завершить все остальные</Button>
  </section>;
}
