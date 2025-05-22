import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Needed in vite and similar environments until ~ pouchdb 10
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Wasm is only needed for the automerge crdt demo
import wasmPlugin from 'vite-plugin-wasm'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    nodePolyfills(),
    wasmPlugin()
  ]
})
