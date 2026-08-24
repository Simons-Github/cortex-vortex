import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode, command }) => {
  // Vite already exposes `import.meta.env.VITE_*` to client code automatically,
  // but the SSR/server-function bundle built by Nitro needs the same values
  // inlined explicitly, so `loadEnv` + `define` keeps both sides consistent.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define: envDefine,
    resolve: {
      tsconfigPaths: true,
      alias: {
        "@": `${process.cwd()}/src`,
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
        "three",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "three",
        "@react-three/fiber",
        "@react-three/postprocessing",
        "postprocessing",
      ],
    },
    server: {
      port: 8080,
    },
    plugins: [
      tailwindcss(),
      tanstackStart({
        // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
        // nitro/vite builds from this.
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: {
            // `src/lib/gemini.ts` holds GEMINI_API_KEY / per-request user keys and
            // the raw @google/genai client. `src/server/**` holds AES-GCM, the
            // service_role BYOK store, and token verification. None of that may
            // reach the client bundle.
            files: ["**/server/**", "src/lib/gemini.ts"],
            specifiers: ["server-only"],
          },
        },
      }),
      // Nitro only for production builds. No hardcoded preset — on Vercel it
      // auto-selects the vercel preset (Build Output API); locally it defaults
      // to node-server so `node .output/server/index.mjs` still works.
      ...(command === "build" ? [nitro()] : []),
      viteReact(),
    ],
  };
});
