# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start development server with Vite
- `npm run build` - Build the application
- `npm run preview` - Preview the built application
- `npm run format` - Format code with Prettier

### Dependencies
All dependencies are in devDependencies since this is a client-side application. Key packages:
- `pouchdb-browser` and `pouchdb-find` for offline-first database functionality
- `yjs` for CRDT-based conflict resolution
- `arktype` for runtime type validation
- `json-merge-patch` for document diffing
- `marked` for rendering README content

## Architecture

### Core Concept
This is an offline-first todo application demonstrating PouchDB/CouchDB synchronization patterns. The application showcases conflict resolution strategies, CRDT integration, and real-time collaboration features.

### Key Components
- **src/Todos.svelte**: Main component containing all PouchDB logic, conflict resolution, and UI state management
- **src/App.svelte**: Simple wrapper providing online/offline controls and remote database switching
- **src/schema.js**: Arktype-based validation schemas for Todo documents and PouchDB metadata
- **src/lib/yjs-helpers.js**: Utilities for CRDT-based text conflict resolution using Yjs

### Database Design
- Uses fractional indexing for distributed list ordering (`order` field)
- Documents include `_id`, `text`, `done`, `archived`, and `order` fields
- Optional Yjs CRDT support via attachments when text contains "@yjs"
- Conflict resolution handles different strategies for different fields:
  - `order`: Takes maximum value
  - `done`/`archived`: Falls back to false to prevent data loss
  - `text`: Either shows explicit conflicts or uses Yjs merging

### Sync Architecture
- Primary database per user instance (named 'a', 'b', etc.)
- Optional remote sync to either:
  - Another local PouchDB instance (simulation mode)
  - Real CouchDB via CORS proxy in `functions/_couch/`
- Changes feed with live updates and conflict detection
- Client-side conflict resolution with edit tracking to prevent sync loops

### State Management
- Separates list order/filtering from document content for efficiency
- Uses PouchDB find() with custom index on `['archived', 'done', 'order']`
- Reactive updates via Svelte's `$effect` and `$state`
- CRDT cache management for text editing performance

### Special Features
- **Offline-first**: Full functionality without network
- **Real-time sync**: Live changes feed with immediate UI updates
- **Conflict resolution**: Multiple strategies including CRDT for text
- **Drag-and-drop reordering**: Fractional indexing prevents conflicts
- **Binary attachments**: Yjs state stored as PouchDB attachments
- **Debug UI**: Live changes feed and conflict visualization

### Vite Configuration
- `define: { global: "window" }` required for PouchDB browser compatibility
- Manual `events` package dependency for Node.js polyfills