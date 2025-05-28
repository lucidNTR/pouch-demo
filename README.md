This is a showcase for using pouchdb and couchdb in a simple to follow offline first todo app.
The svelte project is kept as minimal as possible with all relevant code in a single annotated component [./src/Todo.svelte](Todo.svelte) and focussing on the pouchdb usage more than showing the best way to build the svelte parts. In a real world app the data handlig would be a separate module and possibly using a svelte store or something like a tanstack query data layer.

The aim is to be a bit more realistic than typical first introductios, while skipping a few error handling and edge cases to stay conscise.

The demo is available on https://pouch.lanes.pm or on stackblitz at: https://stackblitz.com/github/lucidNTR/pouch-demo?file=src%2FTodos.svelte

## Things to try out:
- add todos, use the "go offline" button, make changes and go online again to see the changes syncing
- go offline again, mark a todo as done and change the text on one side, while only changing the text on the other side. Go online again and notice the conflict is shown but the checked state is always reverted to undone to prevent logical dataloss
- create a conflict by moving and checking todos while in offline, then go online and see that conflicts are resolved automatically
- add "@yjs" to a todo to opt it into crdt based text conflict resolution and edit it in offline mode on both sides, go online and notice it is automatically resolved by yjs merge without showing a conflict to the user.
- open the app in two browsers and switch to the real couchdb sync backend with the top right button, do similar tests and see the sync happen via the network
- switch the sync back to the second pouchdb as sync target by clicking "emulate remote" and see the changes from the remore being synced to the second pouchdb via the first instance
- observe what happens in the sync feed underneath the main UI

## Things shown in the code:
- core concepts of documents, primary ids (_id), revisions (_rev), database sequence ids (_seq)
- replication to a local first pouchdb and optional remote collaborative couchdb with online/ offline handling
- conflict resoltion with multiple strategies 
- optional crdt resolution for text fields
- smart data design for sync without crdts with fractional indexing for ordering lists
- use of binary attachments
- working with changes streams
- use of an index for sorting and filtering
- live updating ui rerender with optimized rerender detection
- diffing of changes
- validation

NOTE: If you use this as getting started point for your own project: to use pouchdb in vite you currently need vite-plugin-node-polyfills and the package you want is pouchdb-browser not pouchdb (which includes lots of nodejs specific dependencies not relevant for most usecases)
