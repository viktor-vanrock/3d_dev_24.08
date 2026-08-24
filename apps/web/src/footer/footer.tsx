import version from "../../../../version.json";
import "./footer.css";

const LEGAL_LINKS = [
  { label: "Публичная лицензия", href: "/legal/license" },
  { label: "Политика приватности", href: "/legal/privacy" },
  { label: "Политика использования", href: "/legal/terms" },
  { label: "Обратная связь", href: "mailto:support@3mf.tech" },
] as const;

const NAVIGATION_LINKS = [
  { label: "Дом", href: "/" },
  { label: "Новости", href: "/feed" },
  { label: "Принтеры", href: "/printers" },
  { label: "Проекты", href: "/project" },
  { label: "Форум", href: "/communities" },
  { label: "Личный кабинет", href: "/profile" },
] as const;

const APPLICATION_VERSION = `v${version.year}.${version.release}.${version.minor}`;

function FooterLinks({ links, label }: { links: readonly { label: string; href: string }[]; label: string }) {
  return (
    <nav className="siteFooter__links" aria-label={label}>
      {links.map((link) => (
        <a key={link.href} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

// Служебный конец документа (docs/design/footer.md): находится в обычном потоке, поэтому
// единственный root-экземпляр добавляется app.tsx после текущего экрана.
export function Footer() {
  return (
    <footer className="siteFooter">
      <div className="siteFooter__inner">
        <div className="siteFooter__columns">
          <section className="siteFooter__section siteFooter__about" aria-labelledby="footer-about-title">
            <h2 id="footer-about-title" className="siteFooter__title">О портале</h2>
            <p>3mf.tech — портал 3D-печати: модели, принтеры, филаменты, сообщество</p>
          </section>

          <section className="siteFooter__section" aria-labelledby="footer-navigation-title">
            <h2 id="footer-navigation-title" className="siteFooter__title">Навигация</h2>
            <FooterLinks links={NAVIGATION_LINKS} label="Основная навигация" />
          </section>

          <section className="siteFooter__section" aria-labelledby="footer-legal-title">
            <h2 id="footer-legal-title" className="siteFooter__title">Юридическая информация</h2>
            <FooterLinks links={LEGAL_LINKS} label="Юридические ссылки" />
          </section>
        </div>

        <div className="siteFooter__meta" aria-label="Служебная информация">
          <span>© 2026 3mf.tech</span>
          <span>{APPLICATION_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
