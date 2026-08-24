import { startNestApp } from "./bootstrap.ts";

void startNestApp().catch(() => {
  console.error("api startup failed");
  process.exitCode = 1;
});
