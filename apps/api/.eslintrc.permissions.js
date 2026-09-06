// Правила миграции legacy-проверок доступа. Файл экспортируется в flat-config
// ESLint 9 из eslint.config.mjs: обычные .eslintrc в этом проекте не загружаются.
const permissionLiteral = /^(?:user|moderation|analytics|billing|audit|catalog|research|support)\./;

const legacyPatterns = [
  { selector: "Identifier[name='is_staff']", message: "is_staff удалён: используйте PermissionsService.hasPermission()." },
  { selector: "Identifier[name='ADMIN_USERNAMES']", message: "ADMIN_USERNAMES удалён: используйте permission_grants." },
  { selector: "BinaryExpression[operator=/^(==|===)$/][left.name='role'][right.value='admin']", message: "Не сравнивайте role с admin: используйте PermissionsService.hasPermission()." },
  { selector: "BinaryExpression[operator=/^(==|===)$/][right.name='role'][left.value='admin']", message: "Не сравнивайте role с admin: используйте PermissionsService.hasPermission()." },
  { selector: "BinaryExpression[operator=/^(==|===)$/][left.name='username']", message: "Не проверяйте доступ по username: используйте user_id и разрешения." },
  { selector: "BinaryExpression[operator=/^(==|===)$/][right.name='username']", message: "Не проверяйте доступ по username: используйте user_id и разрешения." },
];

const permissionLiterals = [
  { selector: `Literal[value=/${permissionLiteral.source}/]`, message: "Используйте Permissions.<NAME>, а не строковый литерал разрешения." },
  { selector: `TemplateElement[value.raw=/${permissionLiteral.source}/]`, message: "Используйте Permissions.<NAME>, а не строковый литерал разрешения." },
];

export const permissionsLintConfig = [
  {
    files: ["src/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...legacyPatterns, ...permissionLiterals] },
  },
  {
    // В мастер-домене is_master — разрешённый бизнес-статус. Остальные
    // legacy-паттерны там всё равно запрещены, как и строковые permissions.
    files: ["src/modules/master/**/*.ts"],
    rules: { "no-restricted-syntax": ["error", ...permissionLiterals] },
  },
  {
    // Каталог — единственное место, где строковые значения разрешений объявляются.
    files: ["src/modules/permissions/domain/permissions.catalog.ts"],
    rules: { "no-restricted-syntax": ["error", ...legacyPatterns] },
  },
];
