import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      // Local dev: the app fetches /collab/* root-relative; in production the
      // opencode server serves both. Forward API calls to the server, but keep
      // HTML navigations (/collab/new, /collab/:id) in the SPA.
      "/collab": {
        target: `http://localhost:${process.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`,
        changeOrigin: true,
        bypass(req) {
          if (req.headers.accept?.includes("text/html")) return "/index.html"
        },
      },
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
