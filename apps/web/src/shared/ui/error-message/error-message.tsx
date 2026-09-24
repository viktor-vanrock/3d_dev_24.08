import { Button } from "@shared/ui";
import styles from "./error-message.module.css";

export function ErrorMessage({ message, traceId, retryable, onRetry }: { message: string; traceId?: string; retryable?: boolean; onRetry?: () => void }) {
  return <div className={styles.message} role="alert">
    {message}
    {traceId && <small className={styles.trace}>Код ошибки: {traceId}</small>}
    {retryable && onRetry && <Button type="button" variant="secondary" onClick={onRetry}>Попробовать снова</Button>}
  </div>;
}
