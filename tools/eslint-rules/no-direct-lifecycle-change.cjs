"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Lifecycle-поля проекта изменяются только через ProjectLifecycleService" },
    schema: [{
      type: "object",
      properties: {
        allowedFiles: { type: "array", items: { type: "string" } },
        protectedProps: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    }],
    messages: { forbidden: 'Прямое изменение "{{prop}}" запрещено вне lifecycle-сервиса.' },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const protectedProps = options.protectedProps ?? ["status", "visibility", "published_revision_id", "publishedAt", "published_at", "archivedAt", "archived_at"];
    const allowedFiles = options.allowedFiles ?? ["project-lifecycle.service.ts", "postgres-project.repository.ts"];
    if (allowedFiles.some((file) => context.filename.endsWith(file))) return {};
    const isProjectLike = (node) => node.type === "Identifier" ? /project/i.test(node.name) : node.type === "MemberExpression" && isProjectLike(node.object);
    const propertyName = (node) => node.type === "Identifier" && !node.computed ? node.name : node.type === "Literal" && typeof node.value === "string" ? node.value : null;
    return {
      AssignmentExpression(node) {
        if (node.left.type !== "MemberExpression" || !isProjectLike(node.left.object)) return;
        const property = propertyName(node.left.property);
        if (property !== null && protectedProps.includes(property)) context.report({ node, messageId: "forbidden", data: { prop: property } });
      },
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || node.callee.object.type !== "Identifier" || node.callee.object.name !== "Object" || propertyName(node.callee.property) !== "assign") return;
        const [target, ...sources] = node.arguments;
        if (target === undefined || !isProjectLike(target)) return;
        for (const source of sources) {
          if (source.type !== "ObjectExpression") continue;
          for (const property of source.properties) {
            if (property.type !== "Property") continue;
            const name = propertyName(property.key);
            if (name !== null && protectedProps.includes(name)) context.report({ node: property, messageId: "forbidden", data: { prop: name } });
          }
        }
      },
    };
  },
};
