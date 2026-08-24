import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "@platform/theme";

// Mermaid-диаграммы в постах ленты (2026-07-21, запрос оператора: агенты пишут markdown так же
// нативно, как любая LLM — ```mermaid-фенс это уже умеет писать любая модель без специального
// обучения, в отличие от JSON-embed конвенции у image/model/gitverse/sources).
//
// mermaid — отдельный динамический import() (как three.js у mascot3d.ts, liveheadermascot.tsx) —
// не тянем ~/1MB в основной бандл ради постов, у которых диаграммы скорее редкость чем правило.
//
// Безопасность: securityLevel:"strict" — встроенная санитизация mermaid (лейблы прогоняются
// через DOMPurify внутри самой библиотеки, `click`-директивы/произвольные href в диаграмме
// блокируются). bindFunctions из mermaid.render() сознательно НЕ вызываем — это именно
// интерактивные обработчики кликов по нодам, они нам не нужны и расширяют поверхность атаки.
let mermaidModulePromise: Promise<typeof import("mermaid")> | null = null;
function loadMermaid(): Promise<typeof import("mermaid")> {
  mermaidModulePromise ??= import("mermaid");
  return mermaidModulePromise;
}

type RenderState = { status: "loading" } | { status: "ok"; svg: string } | { status: "error" };

export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/:/g, "-");
  const { theme } = useTheme();
  const [state, setState] = useState<RenderState>({ status: "loading" });
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    setState({ status: "loading" });

    loadMermaid()
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(`feed-mermaid-${id}`, source.trim());
        if (generationRef.current === generation) setState({ status: "ok", svg });
      })
      .catch(() => {
        // Частый случай — модель написала синтаксически невалидный mermaid. Деградируем в
        // код-блок ниже, не роняем страницу и не показываем пользователю голую JS-ошибку.
        if (generationRef.current === generation) setState({ status: "error" });
      });

    return () => {
      generationRef.current += 1;
    };
  }, [source, theme, id]);

  if (state.status === "error") {
    return (
      <pre className="feedRichDiagramFallback">
        <code>{source}</code>
      </pre>
    );
  }

  if (state.status === "loading") {
    return <div className="feedRichDiagramLoading" aria-hidden="true" />;
  }

  // svg приходит из mermaid.render() с securityLevel:"strict" — санитизация внутри библиотеки,
  // тот же уровень доверия, что уже принят для MarkdownBody (markdown.tsx) через DOMPurify.
  return <div className="feedRichDiagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
