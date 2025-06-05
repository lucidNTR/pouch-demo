This is a showcase for using PouchDB and CouchDB in a simple-to-follow offline first todo app.
The svelte project is kept as minimal as possible with all relevant code in a single annotated component [./src/Todos.svelte](Todos.svelte) and focusing on the PouchDB usage more than showing the best way to build the svelte parts. In a real-world app the data handling would be a separate module and possibly using a svelte store or something like a tanstack query data layer.

The aim is to be a bit more realistic than typical first introductions, while skipping a few error handling and edge cases to stay concise.

The demo is available on https://pouch.lanes.pm or on [StackBlitz](https://stackblitz.com/github/lucidNTR/pouch-demo?file=src%2FTodos.svelte).

## Things to try out:

- Add todos, use the "go offline" button, make changes and go online again to see the changes syncing
- Go offline again, mark a todo as done and change the text on one side, while only changing the text on the other side. Go online again and notice the conflict is shown but the checked state is always reverted to undone to prevent logical data loss
- Create a conflict by moving and checking todos while offline, then go online and see that conflicts are resolved automatically
- Add "@yjs" to a todo to opt it into crdt based text conflict resolution and edit it in offline mode on both sides, go online and notice it is automatically resolved by yjs merge without showing a conflict to the user.
- Open the app in two browsers and switch to the real CouchDB sync backend with the top right button, do similar tests and see the sync happen via the network
- Switch the sync back to the second PouchDB as sync target by clicking "emulate remote" and see the changes from the remote being synced to the second PouchDB via the first instance
- Observe what happens in the sync feed underneath the main UI

## Things shown in the code:

- Core concepts of documents, primary ids (\_id), revisions (\_rev), database sequence ids (\_seq)
- Replication to a local first PouchDB and optional remote collaborative CouchDB with online/offline handling
- Conflict resolution with multiple strategies
- Optional crdt resolution for text fields
- Smart data design for sync without crdts with fractional indexing for ordering lists
- Use of binary attachments
- Working with changes streams
- Use of an index for sorting and filtering
- Live updating ui rerender with optimized rerender detection
- Diffing of changes
- Validation

NOTE: If you use this as a getting started point for your own project: to use PouchDB in vite and similar environments, you currently need the events npm package as well as the `define: { global: "window" }` setting. Also note that you probably want to use the pouchdb-browser not pouchdb package (which includes lots of nodejs specific dependencies not relevant for most use cases)
