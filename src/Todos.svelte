<script>
	import { onDestroy } from 'svelte'
	import { flip } from 'svelte/animate'
	import pouchDB from 'pouchdb-browser'
	import findPlugin from 'pouchdb-find'
	import jsonmergepatch from 'json-merge-patch'
	import { yjs, updateCrdt, makeYjsDoc } from './lib/yjs-helpers.js'
	import { Todo, type } from './schema.js'

	let {
		name,
		remote = null,
		db = $bindable()
	} = $props()

	let errors = $state({})

	/** @type {string[]} **/ 
	let list = $state([])
	/** @type {Record<string, typeof Todo.infer>} **/ 
	let docs = $state({})
	let crdts = {}

	// @ts-ignore - (svelte component ts issue, typed correctly in external svelte files or plain ts/js)
	db = new pouchDB.plugin(findPlugin)(name)

	const sortOrder = ['archived', 'done', 'order']
	let filter = $state('')
	db.createIndex({
		index: { fields: sortOrder }
	}).then(() => {
		filter = 'active'
	})
	$effect(() => {
		filter && refreshTodos()
	})

	async function resolveConflicts (tempWinner, conflicts) {        
		for (const conflict of conflicts) {
			if (!conflict) {
				continue
			}
			const diff = jsonmergepatch.generate(tempWinner, conflict)
			
			for (const key of Object.keys(diff).filter(key => !['_rev', '_attachments', '_conflicts'].includes(key))) {
				if (key === 'order') {
					// The order is not that important and we get away with always picking the highest order
					tempWinner.order = Math.max(tempWinner.order, conflict.order)
				} else if (key === 'done') {
					// we always fall back to undone if there is a conflict. Conflicts here cannot happen unless one side makred a todo as undone again
					tempWinner.done = false
				} else if (key === 'archived') {
					// we always fall back to unarchived if there is a conflict for the same reason as above
					tempWinner.archived = false
				} else if (key === 'text') {
					if (tempWinner.yjs && conflict.yjs) {
						const winYDoc = await makeYjsDoc(await db.getAttachment(tempWinner._id, 'yjs',{ rev: tempWinner._rev }))

						const conflictYDoc = await makeYjsDoc(await db.getAttachment(conflict._id, 'yjs',{ rev: conflict._rev }))
						
						yjs.applyUpdate(winYDoc, yjs.encodeStateAsUpdate(conflictYDoc))
						tempWinner.text = winYDoc.getText('text').toString()
					} else {
						tempWinner.text = `${tempWinner.text} (conflict: "${conflict.text}")`
					}
				}
			}
		}

		delete tempWinner._conflicts
		await db.bulkDocs([
			tempWinner,
			...conflicts.map(conflict => ({
				...conflict,
				_deleted: true
			}))
		])
	}

	let editingId = null
	let lastLocalSeq = $state(null)
	let changes = $state([])
	db.changes({
		live: true,
		since: 'now',
		filter: doc => !doc._id.startsWith('_design/')
	}).on('change', async change => {
		lastLocalSeq = change.seq

		change.doc = Todo(await db.get(change.id, { revs_info: true, conflicts: true }))

		if (change.doc instanceof type.errors) {
			console.error(change.doc.summary, change.doc)
			return
		}

		const conflicts = change.doc._conflicts && (await db.get(change.doc._id, { open_revs: change.doc._conflicts })).map(conflict => conflict.ok)

		if (conflicts) {
			resolveConflicts(change.doc, conflicts)
		}

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

		// Prevent messing up editing text while getting updates. saving will raise conflict and can be handled by resolver
		if (editingId !== change.id) {
			docs[change.id] = change.doc

			if (crdts[change.id] && change.doc.text !== crdts[change.id].text) {
				delete crdts[change.id]
			}

			for (const key of sortOrder) {
				if (!oldDoc || (oldDoc[key] !== change.doc[key])) {
					refreshTodos()
					break
				}        
			}
		}
	})

	const initialLoad = $state({})
	async function refreshTodos () {
		const { docs: newDocs } = await db.find({
			selector: {
				archived: filter === 'archived',
				done: { $exists: true },
				order: { $exists: true },
			},
			fields: initialLoad ? undefined : ['_id'],
			sort: sortOrder.map(key => ({ [key] : 'desc' })),
			limit: 1000
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


	// Handle replication
	let syncDoc = $state({ _id: '_local/sync', last_seq: null, _rev: undefined })
	db.get('_local/sync').then(doc => syncDoc = doc).catch(() => {})
	let unsyncedChanges = $derived((syncDoc.last_seq && lastLocalSeq) ? lastLocalSeq - syncDoc.last_seq : 0)
	let replication = null
	$effect(() => {
		replication?.cancel()
		replication = null

		if (remote) {
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
		}
	})

	// Handle adding todos
	let newTodo = $state('')
	function add () {
		const endOfList = list.at(-1)
		const previousOrder = (endOfList && docs[endOfList]?.order) ? docs[endOfList]?.order : 0

		const newDoc = Todo({ _id: crypto.randomUUID(), text: newTodo, done: false, archived: false, order: previousOrder - 1 })

		if (newDoc instanceof type.errors) {
			console.error(newDoc.summary, newDoc)
			errors['_add'] = newDoc
		} else {
			db.put(newDoc)
			newTodo = ''
			delete errors['_add']
		}
	}


	// Handle drag and drop reordering todos
	let draggingId = $state('')
	let dragoverId = $state('')
	function move (moveAboveDoc, idToMove, index) {
		if (docs[idToMove].done !== moveAboveDoc.done) {
			return
		}

		let newOrder
		const previousId = (index - 1) >= 0 && list.at(index - 1)
		const previousDoc = previousId ? docs[previousId] : null
		
		if (previousDoc && previousDoc.done === moveAboveDoc.done) {
			newOrder = (previousDoc.order + moveAboveDoc.order) / 2
		} else {
			newOrder = moveAboveDoc.order + 1
		}

		db.put({...docs[idToMove], order: newOrder})
	}


	// Handle live editing todos text, this is mainly important to demo crdt text editing
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
				// We switch the text field to a crdt if the @yjs demo keyword is encountered
				if (doc.yjs) {
					crdts[doc._id] = await makeYjsDoc(await db.getAttachment(doc._id, 'yjs',{ rev: doc._rev }))
				} else {
					const ydoc = new yjs.Doc()
					ydoc.getText('text').insert(0, newText)
					crdts[doc._id] = ydoc
				}
			}

			// Crdts need updates to their datastructures as often as possible, 
			// but the pouchdb sync should be used for bigger changes.
			// If a realtime text colaboration would be implemented you would also not use the document sync for keystrokes 
			// but instead use a realtime client stream for the keystrokes and combine that with the document sync for snapshotting and the final session persistence.
			updateCrdt(crdts[doc._id], newText)
		}
	}


	// Handle finish editing todo text and persisting the changes
	async function handleBlur (e, doc) {
		const newText = e.target.value
		if (doc.text === newText) {
			return
		}

		let updatedDoc = null

		if (!e.target.value.includes('@yjs') && (crdts[doc._id] || doc.yjs)) {
			// Remove yjs handling if the keyword is removed
			doc.yjs = false
			delete crdts[doc._id]
			const { rev } = await db.removeAttachment(doc._id, 'yjs', doc._rev)
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
			db.put(updatedTodo, { force: true })
			delete errors[doc._id]
		}
	}


	// Final cleanup
	onDestroy(() => {
		replication?.cancel()
		db.close()
	})
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
				role="list"
				animate:flip={{ duration: 100 }}
				class:dragover={dragoverId === doc._id}
				ondrop={() => move(doc, draggingId, i)}
				ondragend={() => { draggingId = ''; dragoverId = ''}}
				draggable={draggingId === doc._id}
				ondragover={e => { e.preventDefault(); dragoverId = doc._id}} >

					<input class="checkbox" type="checkbox" checked={doc.done} onchange={function () { db.put({...doc, done: this.checked}) }} >
					
					<input
						class:error={errors[doc._id]}
						type="text"
						style="padding-right: 40px;"
						value={doc.text} 
						onfocus={() => { editingId = doc._id }}
						onblur={e => { handleBlur(e, doc); editingId = null }}
						onkeydown={e => handleKeyDown(e, doc)} >
					
					<button class="delete" onmousedown={() => db.put({ ...doc, archived: true } )}>❌</button>
					
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
		<input class:error={errors['_add']} type="text" style="margin-left: 31px" placeholder="add todo" bind:value={newTodo} onkeydown={e => { e.key === 'Enter' && add()}}> 
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
