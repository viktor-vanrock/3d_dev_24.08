// Фавиконки провайдеров входа, скачаны в src/assets — public, стандартная
// практика для «Войти через X»-кнопок, аналогично Google/Apple sign-in.
// sberid.png — официальная иконка личного кабинета Сбер ID (id.sber.ru/profile/front-master/icon32.png).
import plagIdIcon from "@shared/assets/plagid.svg";
import sberIdIcon from "@shared/assets/sberid.png";

export function MethodIcon({ provider, muted }: { provider: "plagid" | "sberid"; muted?: boolean }) {
  const src = provider === "plagid" ? plagIdIcon : sberIdIcon;
  return (
    <img
      src={src}
      alt=""
      width={20}
      height={20}
      style={{
        borderRadius: 6,
        flexShrink: 0,
        opacity: muted ? 0.5 : 1,
        filter: muted ? "grayscale(1)" : undefined,
      }}
    />
  );
}
