export type AssistantPageKind = "home" | "feed" | "printers" | "projects" | "site";

export interface AssistantPageContext {
  kind: AssistantPageKind;
  label: string;
  placeholder: string;
  pathname: string;
}

export const ASSISTANT_OPEN_EVENT = "portal:assistant-open";
export const ASSISTANT_CONTEXT_SEARCH_EVENT = "portal:assistant-context-search";

export function assistantPageContext(pathname = window.location.pathname): AssistantPageContext {
  if (pathname === "/" || pathname === "") {
    return { kind: "home", label: "", placeholder: "Что хотите напечатать?", pathname };
  }
  if (pathname.startsWith("/feed") || pathname.startsWith("/news")) {
    return { kind: "feed", label: "", placeholder: "Что обсуждают?", pathname };
  }
  if (pathname.startsWith("/printers") || pathname.startsWith("/printer")) {
    return { kind: "printers", label: "", placeholder: "Какой принтер ищете?", pathname };
  }
  if (pathname.startsWith("/project") || pathname.startsWith("/market")) {
    return { kind: "projects", label: "", placeholder: "Что хотите собрать?", pathname };
  }
  return { kind: "site", label: "", placeholder: "Что хотите найти?", pathname };
}

export function dispatchAssistantContextSearch(query: string, context = assistantPageContext()): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_CONTEXT_SEARCH_EVENT, { detail: { query, context } }));
}

export function openAssistantExperience(query = "", context = assistantPageContext()): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: { query, context } }));
}

export interface AssistantOpenDetail {
  query?: string;
  context?: AssistantPageContext;
}

export interface AssistantContextSearchDetail {
  query: string;
  context: AssistantPageContext;
}
