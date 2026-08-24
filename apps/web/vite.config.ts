/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@app": src("app"),
      "@pages": src("pages"),
      "@domains": src("domains"),
      "@shared": src("shared"),
      "@platform": src("platform"),
    },
  },
  plugins: [
    react(),
    // PWA-каркас (MF-432): injectManifest, не generateSW — офлайн-стратегии по типам
    // ресурсов (лента network-first, картинки stale-while-revalidate, антипиратский
    // запрет на кэш source/download) не укладываются в generateSW-пресеты, нужен
    // ручной src/sw.ts. registerType:"prompt" — обновление СВ только по явному
    // согласию юзера (main.tsx слушает onNeedRefresh), не skipWaiting молча под ногами.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // API-прокси (models/thumb.webp и т.п.) кэшируются рантайм-роутами в sw.ts, не
        // прекэшем — исключаем из precache-манифеста, чтобы sw.ts сам решал retention.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      registerType: "prompt",
      injectRegister: false,
      devOptions: {
        enabled: false,
      },
      manifest: {
        id: "/",
        name: "3mf.tech — портал мейкеров",
        short_name: "3mf.tech",
        description: "Маркетплейс 3D-моделей, мультипринтер-парк и комьюнити мейкеров",
        lang: "ru",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // --ref-color-teal-950 (theme/tokens.css) — тёмный киоск-фон, единственная
        // тема манифеста (media-query manifest ещё не кросс-браузерный).
        background_color: "#0a1512",
        theme_color: "#0a1512",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
