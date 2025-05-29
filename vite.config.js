import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
    // global: "window" is needed in vite and similar environments, 
    // also needs manual adding of the events package to the project (see package.json)
    define: { global: "window" },
    plugins: [svelte()]
})
