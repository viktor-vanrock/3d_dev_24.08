"use strict";

/** Prevent accidental whole-file buffering on upload paths. */
module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Forbid whole-file buffering in upload paths" },
    schema: [],
    messages: {
      noBufferConcat: "Buffer.concat запрещён в upload потоке. Используй putStreamingObject().",
      noReadFile: "readFile запрещён в upload потоке — файл попадёт в память целиком.",
      noMemoryStorage: "memoryStorage() запрещён — используй busboy stream.",
      noBase64Upload: "base64 преобразование файла запрещено в upload потоке.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    const uploadFiles = ["upload.service.ts", "projects.controller.ts", "community.service.ts", "feed.adapters.ts"];
    if (!uploadFiles.some((file) => filename.endsWith(file))) return {};

    function isAllowedSourceValidation(node) {
      let current = node.parent;
      while (current) {
        if ((current.type === "MethodDefinition" || current.type === "FunctionDeclaration") && current.key?.name === "validateSourceInS3") return true;
        current = current.parent;
      }
      return false;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "Buffer" && callee.property.type === "Identifier" && callee.property.name === "concat" && !isAllowedSourceValidation(node)) {
          context.report({ node, messageId: "noBufferConcat" });
        }
        if (callee.type === "Identifier" && ["readFile", "readFileSync"].includes(callee.name)) context.report({ node, messageId: "noReadFile" });
        if (callee.type === "MemberExpression" && callee.property.type === "Identifier" && callee.property.name === "memoryStorage") context.report({ node, messageId: "noMemoryStorage" });
        if (callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "Buffer" && callee.property.type === "Identifier" && callee.property.name === "from" && node.arguments[1]?.type === "Literal" && node.arguments[1].value === "base64") {
          context.report({ node, messageId: "noBase64Upload" });
        }
      },
    };
  },
};
