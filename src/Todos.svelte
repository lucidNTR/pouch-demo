<script>
	import { onDestroy, untrack } from 'svelte'
	import { flip } from 'svelte/animate'
	import pouchDB from 'pouchdb-browser'
	import findPlugin from 'pouchdb-find'
	
	// PouchDB stores and syncs full document snapshots. While not required, it is often helpful to use a diffing library like json-merge-patch to simplify many operations.
	import jsonmergepatch from 'json-merge-patch'

	// It is a common misconception that the couchdb sync protocol and CRDTs are mutually exclusive. It's completely up to the application developer to add CRDTs (or any other strategy) for conflict resolution of complete documents or certain parts. The sync protocol itself only makes sure that conflicts are detected, synchronized and exposed to the application.
	import { yjs, updateCrdt, makeYjsDoc } from './lib/yjs-helpers.js'

	// CouchDB and PouchDB are schema-less and work well with how much or little schema you want to add. JSON Schema libraries like ajv or modern typescript-first libraries like arktype (used here) have proven effective and more flexible than prescriptive baked-in solutions.
	// If you use typescript also check out how to add type paramers like `db.allDocs<MyType>` or `PouchDB.Core.ExistingDocument<MyType>` https://neighbourhood.ie/blog/2025/03/26/offline-first-with-couchdb-and-pouchdb-in-2025#pouchdb-and-typescript
	import { Todo, type } from './schema.js'

	let {
		name,
		remote = null,
		db = $bindable()
	} = $props()

	let errors = $state({})

	// It is a helpful pattern to manage the state of a list like order, paging status and filters separately from the documents themselves. This allows efficient updating and fetching as well as clearer code reasoning.
	/** @type {string[]} **/ 
	let list = $state([])
	/** @type {Record<string, typeof Todo.infer>} **/ 
	let docs = $state({})
	let crdts = {}

	// @ts-ignore - (svelte component ts issue, typed correctly in external svelte files or plain ts/js)
	db = new pouchDB.plugin(findPlugin)(name)

	// This innocent seeming array defining the sort order of the main view index for this app is a key factor to use PouchDB efficiently.
	// If you used IndexedDB indexes, Dexie or a KV store with range support before, the concept should be familiar. The index is sorted from left to right (BY archived state AND done state AND order). We use this index so we can filter by archive state and show all done items first while ordering the items that are done or undone in the manually assigned order.
	const sortOrder = ['archived', 'done', 'order']
	let filter = $state('')
	db.createIndex({
		index: { fields: sortOrder }
	}).then(() => {
		filter = 'active'
	})
	// As creating an index is async and the index will not be available on the first start, we skip setting a filter and thus rendering the list until that has happened, after that the effect makes sure the list is refreshed whenever the filter changes
	$effect(() => {
		filter && refreshTodos()
	})

	// One of the unique features of PouchDB is the level of control it gives developers over conflict data consistency as well as when and how the conflicts are handled. This conflict resolver shows how you can combine different strategies for different parts of the data.
	async function resolveConflicts (tempWinner, conflicts) {  
		console.log('resolveConflicts', name, tempWinner, conflicts)

		// PouchDB chooses a temporary winner that is guaranteed to be the same on all clients and used by code that does not handle conflicts until they are resolved. This behavior is sometimes misrepresented as using last-write-wins for resolution. We show a two-way merge here but for more advanced merges and complicated state transitions it is sometimes worth it to keep track of the materialized diffs (also unlocking a multitude of use cases requiring access to version history of the data) and do a three-way merge similar to git. [https://neighbourhood.ie/blog/2020/09/15/use-json-patch-to-resolve-conflicts] has a great article how this can be accomplished.

		// Clone the temp winner as the base for conflict resolution
		const winner = structuredClone(tempWinner)
		delete winner._conflicts

		// Enable Yjs CRDT resolution only if all conflicting documents have Yjs data
		const hasYjs = winner.yjs && conflicts.every(c => !!c.yjs)
		const conflictYDocs = []

		for (const conflict of conflicts) {
			const diff = jsonmergepatch.generate(tempWinner, conflict)
			
			for (const key of Object.keys(diff).filter(key => !['_rev', '_attachments', '_conflicts'].includes(key))) {
				if (key === 'order') {
					// The order is not that important and we can always pick the highest order. Fractional indexing makes this especially easy as you cannot lose a todo or run into big issues when todos end up with the same order.
					winner.order = Math.max(winner.order, conflict.order)
				} else if (key === 'done') {
					// We always fall back to undone if there is a conflict. Conflicts here cannot happen unless one side marked a todo as undone again.
					winner.done = false
				} else if (key === 'archived') {
					// We always fall back to unarchived if there is a conflict for similar reasoning as above.
					winner.archived = false
				} else if (key === 'text') {
					if (hasYjs) {
						conflictYDocs.push(await makeYjsDoc(await db.getAttachment(conflict._id, 'yjs',{ rev: conflict._rev })))
					} else {
						// If we use standard conflict resolution we just expose the conflict in the text to be manually resolved. This is often good enough and very explicit especially in many common scenarios where concurrent edits are rare and conflicts even rarer. Another simple but effective strategy is to make conflicts explicit in a comment field.
						winner.text = `${winner.text} (conflict: "${conflict.text}")`
					}
				}
			}
		}

		if (conflictYDocs.length) {
			// The Yjs resolution strategy merges all the conflicts with yjs into the winner and updates the text field and the yjs attachment accordingly. PouchDB attachments are a great way to store binary data like a small thumbnail or a yjs serialization.
			let winYDoc = await makeYjsDoc(await db.getAttachment(tempWinner._id, 'yjs',{ rev: tempWinner._rev }))
			
			for (const conflictYDoc of conflictYDocs) {
				yjs.applyUpdate(winYDoc, yjs.encodeStateAsUpdate(conflictYDoc))
			}

			winner.text = winYDoc.getText('text').toString()
			winner._attachments.yjs = {
				content_type: "application/octet-stream",
				data: new Blob([yjs.encodeStateAsUpdate(winYDoc)], { type: 'application/octet-stream' })
			}
		}

		// Conflicts are resolved by deleting conflicting revisions and updating the temp winner to the resolved state. If the temp winner happens to be the same as the merged winner we don't have to write it again but can just delete all the conflicts.
		const toUpdate = conflicts.map(conflict => ({
			...conflict,
			_deleted: true
		}))

		const winnerDiff = jsonmergepatch.generate(tempWinner, winner)
		const tempWinnerHadChanges = Object.keys(winnerDiff).filter(key => !['_rev', '_attachments', '_conflicts'].includes(key)).length > 0

		if (tempWinnerHadChanges) {
			toUpdate.push(winner)
		}

		// The bulkDocs api is a handy and efficient way to update multiple documents at once and also supports deletions by setting the _deleted flag.
		await db.bulkDocs(toUpdate)
	}

	// Conflict resolution is best handled in a worker on a sync server when possible. While PouchDB supports any kind of setup such as client-side resolution, it requires some extra work to get right and is usually only worth it in rare special cases like this demo which is supposed to show resolution even without any server at all. The common pitfall for this case is having multiple clients trying to resolve the same conflicts simultaneously, creating a sync loop. We avoid this here by keeping track of each client's own edits and then only resolving conflicts from their own edits.
	let myEdits = new Set()

	// We don't want to change a text field from sync while editing, so we keep track and lock the currently edited todo.
	let editingId = null

	// PouchDB uses a sequence id (seq) representing the change state of the database. This is unique for each database (even if they are syncing the same data) and can be used to keep track of everything a client has seen. A common pattern is to read everything from a database a client is interested in, remembering the last sequence id and then only fetching changes from then on by using the sequence id as the since parameter in the changes feed. The replication protocol itself does the same thing on steroids with the added handling of edge cases for all the topologies, handling conflicts and many more.
	let lastLocalSeq = $state(null)
	let changes = $state([])
	const changesFeed = db.changes({
		// The changes feed supports live updates which is very useful for creating live updating UIs.
		live: true,
		
		// The special 'now' value is a shortcut for the last sequence id of the database to only get changes from then on.
		since: 'now',
		
		// Changes feeds can be filtered to exclude certain documents not interesting to the client. Normally it is better to filter server side as that is more efficient but it's also possible to use an ad hoc function as shown here. This filter is used to exclude design documents (which store information about indexes, validation and other database information)
		filter: doc => !doc._id.startsWith('_design/')
	}).on('change', async change => {
		lastLocalSeq = change.seq

		// Fetch doc separately to get conflicts and revision info, normally docs can be included in the changes feed with include_docs: true
		// Parse and validate immediately for type safety
		change.doc = Todo(await db.get(change.id, { revs_info: true, conflicts: true }))

		if (change.doc instanceof type.errors) {
			console.error(change.doc.summary, change.doc)
			return
		}

		// If a new change has existing conflicts we get the docs for these conflicting states and call the resolver if the conflicts stem from our own edits.
		const conflicts = change.doc._conflicts && (await db.get(change.doc._id, { open_revs: change.doc._conflicts })).map(conflict => conflict.ok)

		if (conflicts && myEdits.has(change.doc._rev)) {
			resolveConflicts(change.doc, conflicts.filter(conflict => !!conflict))
		}

		// PouchDB does not guarantee that all revisions are synced and available, only the latest ones. In order to show as much information as possible in the changes table debug UI we try to find an existing previous revision to render a diff, otherwise we show the changed document as is in its full state.
		const firstAvailableIndex = change.doc._revs_info.findIndex((rev, i) =>  i !== 0 && rev.status === 'available')
		const firstAvailableRev = change.doc._revs_info[firstAvailableIndex]?.rev

		delete change.doc._revs_info
		delete change.doc._conflicts
		change.conflicts = conflicts?.map(conflict => ({ left: jsonmergepatch.generate(change.doc, conflict), right: jsonmergepatch.generate(conflict, change.doc) })) 

		const ancestor = firstAvailableRev && await db.get(change.doc._id, { rev: firstAvailableRev })
		if (ancestor) {
			if (firstAvailableIndex > 1) {
				change.skippedVersions = firstAvailableIndex - 1
			}
			change.diff = jsonmergepatch.generate(ancestor, change.doc)
		}

		const oldDoc = docs[change.id]
		changes = [change, ...changes]

		// Prevent messing up editing text while getting updates. We are saving updates in a way to raise conflicts via the conflict handler and can be handled by the resolver the same way as if the changes were made while offline.
		if (editingId !== change.id) {

			// We update the local doc cache with the new state to immediately reflect the changed data and update the UI.
			docs[change.id] = change.doc

			// Invalidate CRDT cache if text changed
			if (crdts[change.id] && change.doc.text !== crdts[change.id].text) {
				delete crdts[change.id]
			}

			// We can be smart about when to reload the list itself as the only way it can change is if the data that changed affects the keys that are used for sorting and filtering.
			for (const key of sortOrder) {
				if (!oldDoc || (oldDoc[key] !== change.doc[key])) {
					refreshTodos()
					break
				}        
			}
		}
	})

	// We fetch the order and doc content in one go on initial load and on later updates separately. This allows more efficient fetching and state management.
	const initialLoad = $state({})
	async function refreshTodos () {
		const { docs: newDocs } = await db.find({
			// PouchDB find uses MongoDB-inspired Mango syntax for filtering and sorting
			selector: {
				archived: filter === 'archived',
				done: { $exists: true },
				order: { $exists: true },
			},
			fields: initialLoad ? undefined : ['_id'],
			sort: sortOrder.map(key => ({ [key] : 'desc' })),
			limit: 500
		})
		
		if (!initialLoad[filter]) {
			for (const doc of newDocs) {
				const todo = Todo(doc)

				if (todo instanceof type.errors) {
					console.error(todo.summary, doc)
				} else {
					docs[doc._id] = todo
				}
			}
			initialLoad[filter] = true
		}
		list = newDocs.map(doc => doc._id)
	}


	// PouchDB can store data that should not be replicated and trigger sync with the _local/ prefix. This is often used in advanced use cases to keep manual track of replication state or client local information that could also be stored in local storage. You barely need to do something like this but we can use the sequence numbers to calculate the number of unsynced changes. CouchDB does not use integers as sequence, so this only works for the local PouchDB.
	let syncDoc = $state({ _id: '_local/sync', last_seq: null, _rev: undefined })
	db.get('_local/sync').then(doc => syncDoc = doc).catch(() => {})
	let unsyncedChanges = $derived((syncDoc.last_seq && lastLocalSeq) ? lastLocalSeq - syncDoc.last_seq : 0)
	let replication = null
	$effect(() => {
		// This effect triggers whenever the remote sync target changes, so we cancel any existing sync and restart it with the new target.
		replication?.cancel()
		replication = null

		if (remote) {
			untrack(() => {
				replication = db.sync(remote, {
					live: true,
					retry: true,
					attachments: true
				})
				replication.push.on('paused', async (err) => {          
					if (!err) {
						syncDoc.last_seq = (await db.info()).update_seq
						syncDoc._rev = (await db.put(syncDoc)).rev
					}
				})
			})
		}
	})

	let newTodo = $state('')
	function add () {
		// Fractional indexing for distributed list ordering handles conflicts efficiently
		// and prevents inconsistent states. Real implementations need edge case handling
		// for very fractions getting too small or identical indices, but this works for most use cases.
		const endOfList = list.at(-1)
		const previousOrder = (endOfList && docs[endOfList]?.order) ? docs[endOfList]?.order : 0

		const newDoc = Todo({ 
			_id: crypto.randomUUID(), 
			text: newTodo, 
			done: false, 
			archived: false, 
			order: previousOrder - 1 
		})

		if (newDoc instanceof type.errors) {
			console.error(newDoc.summary, newDoc)
			errors['_add'] = newDoc
		} else {
			db.put(newDoc)
			newTodo = ''
			delete errors['_add']
		}
	}


	// Handling drag and drop reordering
	let draggingId = $state('')
	let dragoverId = $state('')
	
	async function move (moveAboveDoc, idToMove, index) {
		// Only allow reordering within the same completion state
		if (docs[idToMove].done !== moveAboveDoc.done) {
			return
		}

		let newOrder
		const previousId = (index - 1) >= 0 && list.at(index - 1)
		const previousDoc = previousId ? docs[previousId] : null
		
		if (previousDoc && previousDoc.done === moveAboveDoc.done) {
			// Fractional indexing: place between previous and current
			newOrder = (previousDoc.order + moveAboveDoc.order) / 2
		} else {
			// Place above current item
			newOrder = moveAboveDoc.order + 1
		}

		const { rev } = await db.put({...docs[idToMove], order: newOrder})
		myEdits.add(rev)
	}

	// Handle live editing todos text to update the crdt on every keystroke.
	// CRDTs need updates to their datastructures as often as possible, but the pouchdb sync is better suited for bigger changes, not every keystroke.
	// If a realtime text collaboration would be implemented it would be a good option to use a realtime client to client stream for the keystrokes and combine that with the document sync for snapshotting and the final session persistence.
	async function handleKeyDown (e, doc) {
		if (e.key === 'Enter' || e.key === 'Escape') {
			e.target.blur()
			return
		}

		const newText = e.target.value
		if (doc.text === newText) {
			return
		}

		if (e.target.value.includes('@yjs')) {
			if (!crdts[doc._id]) {
				// Switch to CRDT when @yjs keyword is encountered
				if (doc.yjs) {
					crdts[doc._id] = await makeYjsDoc(await db.getAttachment(doc._id, 'yjs',{ rev: doc._rev }))
				} else {
					const ydoc = new yjs.Doc()
					ydoc.getText('text').insert(0, newText)
					crdts[doc._id] = ydoc
				}
			}

			updateCrdt(crdts[doc._id], newText)
		}
	}

	// Handle finishing text edit and updating PouchDB document
	async function handleBlur (e, doc) {
		const newText = e.target.value
		if (doc.text === newText) {
			return
		}

		let updatedDoc = null

		if (!e.target.value.includes('@yjs') && (crdts[doc._id] || doc.yjs)) {
			// Remove yjs handling when the keyword is removed
			doc.yjs = false
			delete crdts[doc._id]
			const { rev } = await db.removeAttachment(doc._id, 'yjs', doc._rev)
			myEdits.add(rev)
			updatedDoc = { ...doc, _rev: rev, text: newText, _attachments: undefined }
		} else if (crdts[doc._id]) {
			updateCrdt(crdts[doc._id], newText)

			updatedDoc = { 
				...doc,
				text: newText,
				yjs: true,
				_attachments: {
					yjs: {
						content_type: "application/octet-stream",
						data: new Blob([yjs.encodeStateAsUpdate(crdts[doc._id])], { type: 'application/octet-stream' })
					}
				}
			}
		} else {
			updatedDoc = { ...doc, text: newText }
		}

		const updatedTodo = Todo(updatedDoc)
		if (updatedTodo instanceof type.errors) {
			errors[doc._id] = updatedTodo
		} else {
			// PouchDB has two conflict types:
			// 1. Immediate conflicts (conflicting revision already in database) which are normally handled directly in the UI
			// 2. Sync conflicts (created when syncing new data)
			// Using force: true allows us to use one resolver to handle both types consistently
			const { rev } = await db.put(updatedTodo, { force: true })
			myEdits.add(rev)
			delete errors[doc._id]
		}
	}

	// Cleanup on component destruction
	onDestroy(() => {
		changesFeed.cancel()
		replication?.cancel()
		db.close()
	})

	// @ts-ignore - expose pouchdb for debugging
	window.pouchDB = pouchDB
</script>
	
<article class:archived={filter !== 'active' || !initialLoad[filter]}>
	<header>
		<h3>
			User {name} 
			{#if unsyncedChanges > 0}
				<p class="slow">({unsyncedChanges} unsynced changes)</p>
			{/if}
		</h3>

		<button
			class="filter-button"
			class:hidden={!initialLoad[filter]} 
			onmousedown={() => filter = (filter === 'active' ? 'archived' : 'active')} >
				{filter === 'active' ? 'Show Archived' : 'Show Active'}
		</button>
	</header>

	{#key filter}
		{#each list.flatMap(id => docs[id] || []) as doc, i (doc._id)}
			<div
				class="todo"
				role="listitem"
				animate:flip={{ duration: 100 }}
				class:dragover={dragoverId === doc._id}
				ondrop={() => move(doc, draggingId, i)}
				ondragend={() => { draggingId = ''; dragoverId = ''}}
				draggable={draggingId === doc._id}
				ondragover={e => { e.preventDefault(); dragoverId = doc._id}} >

					<input 
						class="checkbox" 
						type="checkbox" 
						checked={doc.done} 
						onchange={async function () { 
							const { rev } = await db.put({...doc, done: this.checked})
							myEdits.add(rev)
						}} >
					
					<input
						class:error={errors[doc._id]}
						type="text"
						style="padding-right: 40px;"
						value={doc.text} 
						onfocus={() => { editingId = doc._id }}
						onblur={e => { handleBlur(e, doc); editingId = null }}
						onkeydown={e => handleKeyDown(e, doc)} >
					
					<button 
						class="delete" 
						onmousedown={async () => {
							const { rev } = await db.put({ ...doc, archived: true })
							myEdits.add(rev)
						}}>❌</button>
					
					<div
						class="drag"
						role="button"
						tabindex=-1
						onmousedown={() => draggingId = doc._id}
						onmouseup={() => { draggingId = ''; dragoverId = '' }}>⠿</div>
			</div>
		{/each}
	{/key}
	
	<div class="add-todo">
		<input 
			class:error={errors['_add']} 
			type="text" 
			style="margin-left: 31px" 
			placeholder="add todo" 
			bind:value={newTodo} 
			onkeydown={e => { e.key === 'Enter' && add()}}> 
		<button class="add" onmousedown={add}>Add</button>
	</div>

	{#if changes.length || Object.values(errors).length}
		<hr>
		<h4>Changes: <button onmousedown={() => { changes = []; errors = {}; }}>clear</button></h4> 
	{/if}

	<ul>
		{#each Object.entries(errors) as [key, error]}
			<li style="max-width: 425px;">
				<div class="flash danger">{key}: {error.summary}</div>
			</li>
		{/each}

		{#each changes as { doc, seq, diff, conflicts, skippedVersions }}
			<li style="max-width: 425px;">
				db seq: {seq}<br>
				id: {doc._id}
				{#if diff}
					{#if skippedVersions}(skipped {skippedVersions} obsolete changes){/if}
					<pre>diff: {JSON.stringify(diff, null, 2)}</pre>
				{:else}
					<pre>doc: {JSON.stringify(doc, null, 2)}</pre>
				{/if}

				{#if conflicts}
					<pre>conflicts: {JSON.stringify(conflicts, null, 2)}</pre>
				{/if}
			</li>
		{/each}
	</ul>
</article>
