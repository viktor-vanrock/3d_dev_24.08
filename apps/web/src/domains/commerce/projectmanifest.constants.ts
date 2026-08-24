// Browser-safe зеркало двух wire-констант project-code.v1.
//
// Основной контракт (`@portal/contracts/http/models`) содержит server-only sync SHA-256 helpers
// и поэтому закономерно импортирует `node:crypto`. Web использует оттуда только типы, а эти две
// строковые константы держит на своей стороне шва, чтобы Vite не затягивал Node-модуль в браузер.
// Значения покрыты projectmanifest.editor.test.ts и обязаны меняться вместе с контрактом.
export const PROJECT_CODE_CONTRACT_VERSION = "project-code.v1" as const;
export const PROJECT_MANIFEST_SCHEMA_URL = "https://schemas.3mf.tech/project/v1" as const;
