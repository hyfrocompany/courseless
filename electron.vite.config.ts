import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The two public backend values, compiled into the main bundle.
 *
 * A packaged app has no .env.local next to it and no shell environment worth reading, so without
 * this a downloaded build would start up with no backend and no way to sign in. The values are
 * public by design (the anon key is meant to ship in clients; row-level security is what protects
 * data), and a real environment variable still wins at runtime — see src/main/util/env.ts.
 *
 * Order: the developer's own .env.local, then build/public-env.json, which is committed so that a
 * CI runner produces an installer that works.
 */
function bakedEnv(): Record<string, string> {
  const keys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SITE_URL']
  const out: Record<string, string> = { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_SITE_URL: '' }

  const publicFile = resolve(__dirname, 'build/public-env.json')
  if (existsSync(publicFile)) {
    const json = JSON.parse(readFileSync(publicFile, 'utf8')) as Record<string, unknown>
    for (const key of keys) if (typeof json[key] === 'string') out[key] = json[key] as string
  }

  const envFile = resolve(__dirname, '.env.local')
  if (existsSync(envFile)) {
    for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      if (!keys.includes(key)) continue
      out[key] = line.slice(eq + 1).trim().replace(/^["'](.*)["']$/, '$1')
    }
  }

  for (const key of keys) if (process.env[key]) out[key] = process.env[key] as string
  return out
}

const baked = bakedEnv()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __BAKED_SUPABASE_URL__: JSON.stringify(baked.VITE_SUPABASE_URL),
      __BAKED_SUPABASE_ANON_KEY__: JSON.stringify(baked.VITE_SUPABASE_ANON_KEY),
      __BAKED_SITE_URL__: JSON.stringify(baked.VITE_SITE_URL)
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
