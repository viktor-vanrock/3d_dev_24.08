# Теги агентов — UUID-шпаргалка (Autofab)

> Вынесено из сквад-промпта. Проще: команда `mention <Имя>` даёт готовую строку; `multica agent list --output json` — актуальные UUID. Таблица ниже — кэш.

Голый текст «Design» или «@Design» никого не зовёт — так работа умирает
молча. Команда `mention <Имя>` даёт готовую строку. Копируй отсюда:
- CTO: `[@CTO](mention://agent/81bf3e38-3cb4-4d5a-95be-09aac63a1900)`
- Lead: `[@Lead](mention://agent/6befaba2-c4bf-47b8-b3b9-8b074e767b28)`
- UX: `[@UX](mention://agent/74d16932-0865-4796-964a-7b17930a14e4)`
- Growth: `[@Growth](mention://agent/c6c29a75-be9a-48f3-bf3c-a806395fddb6)`
- Domain: `[@Domain](mention://agent/5dbf6ed3-19af-498d-8251-5c53aaf1be71)`
- Design: `[@Design](mention://agent/d6b4a97b-0a34-4bbf-9ba4-b43835aefa52)`
- Fullstack: `[@Fullstack](mention://agent/dd2603c0-a36f-4e6a-8f4c-96daa2726f26)`
- Data: `[@Data](mention://agent/f9dd5512-c593-4f0b-9e6c-e58a025d16c2)`
- Back: `[@Back](mention://agent/1427df29-cd93-47c9-a408-a4e0edfb4c04)`
- Front: `[@Front](mention://agent/579ca1e4-7ccc-441c-8cbe-64a8ad21ca50)`
- Mesh: `[@Mesh](mention://agent/ad3cbd95-0223-482d-b8cc-3c7f98df3a92)`
- AI: `[@AI](mention://agent/612ed28a-04ca-4624-b535-bf0e7af5377e)`
- Ops: `[@Ops](mention://agent/e56a7e84-8aef-4596-9b2f-f85f134c1bc3)`
- QA: `[@QA](mention://agent/0ff5ecd5-83de-49b8-9058-c73d87006b4b)`
- Git: `[@Git](mention://agent/aa56612f-ad59-44c7-b9c3-5b1c039bbc98)`
- Docs: `[@Docs](mention://agent/0871baee-ad50-49f6-825d-d32807985bb0)`
- PM: `[@PM](mention://agent/22059c93-b2e1-4a32-bea8-b816cdf1244f)`
- Cloud.ru: `[@Cloud.ru](mention://agent/7fb419a3-37b1-4204-9489-133d163e3086)`
- Reviewer: `[@Reviewer](mention://agent/5315373a-3a15-4a1e-be4d-460a02a5ae62)`
- Test: `[@Test](mention://agent/3d96ad2f-7734-431e-89d3-8dc2a6f3b5a5)`
- Release: `[@Release](mention://agent/e828a737-54cc-4794-9e1b-20ae675360cb)`
Правило: закончил / встал / передаёшь / просишь / докладываешь вверх —
в том же комменте валидный тег адресата. Коммент без тега = обращения
не было.
