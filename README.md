This is a showcase for using pouchdb and couchdb in a simple to follow offline first todo app.
The svelte project is kept as minimal as possible with all relevant code in a single annotated component [./src/Todo.svelte](Todo.svelte) and focusing on the pouchdb usage more than best way to build the svelte parts, in a real world app the data part would at least be a separate module and possibly a svelte store or something like tanstack query data layer.

The pouchdb usage is aiming to be a bit more real world realistic than a first intro demo while skipping just a few error handling and details that would be present in a production app to be more concise.

The demo can be tried on https://pouch.lanes.pm or on stackblitz at: https://stackblitz.com/github/lucidNTR/pouch-demo?file=src%2FTodos.svelte

### Things to try out:
- add todos, use the "go offline" button, make changes and go online again to see the changes syncing
- go offline again, mark a todo as done and change the text while only changing the text on the other side. Then go online again and notice the conflict is shown but the checked state is always reverted to undone to prevent logical dataloss
- create a conflicts by moving and checking todos while in offline mode and go online and see that conflicts are just resolved automatically
- add "@yjs" to a todo to opt it into crdt based text conflict resolution and edit it in offline mode on both sides, go online and notice its automatically resolved by yjs merge without showing a conflict to the user.
- open the app in two browsers and switch to the real couchdb sync backend, do similar tests and see the sync happen via the network
- switch the sync back to the second pouchdb as sync target by clicking "emulate remote" and see the changes from the remore being synced to the second pouchdb via the first instance
- observe what the sync feed sees underneath the main UI

### Things shown in the project:
- core concepts of documents, primary ids (_id), revisions (_rev), database sequence ids (_seq)
- replication to a local first pouchdb and optional remote collaborative couchdb with online/ offline handling
- batched syncing through a third database that acts as sneakernet
- conflict resoltion with multiple strategies 
- optional crdt resolution for text fields
- smart data design for sync without crdts with the example of fractional indexing for ordering lists
- use of binary attachments
- working with changes streams
- use of an index for sorting and filtering
- live updating ui rerender with optimized rerender detection
- diffing of changes
- validation

NOTE: If you use this as getting started point for your own project: to use pouchdb in vite you currently need vite-plugin-node-polyfills and the package you want is pouchdb-browser not pouchdb (which includes lots of nodejs specific dependencies not relevant for most usecases)
