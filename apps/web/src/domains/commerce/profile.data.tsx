import type { DataCapability } from "@shared/types";
import { Card, Eyebrow, Heading } from "@shared/ui";

const SECTIONS: readonly {
  capability: DataCapability;
  href: string;
  title: string;
  description: string;
}[] = [
  {
    capability: "data.materials.manage",
    href: "/data/materials",
    title: "Материалы",
    description: "Филаменты, смолы, листовые и металлические материалы.",
  },
  {
    capability: "data.printers.manage",
    href: "/data/printers",
    title: "Принтеры",
    description: "Карточки оборудования, характеристики и источники.",
  },
  {
    capability: "data.news.manage",
    href: "/data/news",
    title: "Новости",
    description: "Ручные материалы и публикации из Scout.",
  },
];

export function ProfileData({ capabilities }: { capabilities: readonly DataCapability[] }) {
  const allowed = new Set(capabilities);
  return (
    <section className="profileData" aria-labelledby="profile-data-heading">
      <div className="profileWorkshopIntro">
        <Eyebrow>Управление порталом</Eyebrow>
        <Heading size="md"><span id="profile-data-heading">Данные</span></Heading>
        <p>Рабочее пространство каталогов и редакции.</p>
      </div>
      <div className="profileDataGrid">
        {SECTIONS.filter((section) => allowed.has(section.capability)).map((section) => (
          <a key={section.capability} href={section.href} className="profileDataLink">
            <Card className="profileDataCard">
              <strong>{section.title}</strong>
              <span>{section.description}</span>
            </Card>
          </a>
        ))}
      </div>
    </section>
  );
}
