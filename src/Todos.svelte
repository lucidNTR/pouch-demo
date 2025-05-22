<script>
    import { onDestroy } from 'svelte'
    import { flip } from 'svelte/animate'
    import pouchDB from 'pouchdb-browser'
    import findPlugin from 'pouchdb-find'
    import jsonmergepatch from 'json-merge-patch'
    import * as automerge from "@automerge/automerge/next"

    let {
      name,
      remote = null,
      db = $bindable()
    } = $props()

    let list = $state([])
    let docs = $state({})
    let crdts = {}

    // @ts-ignore - (svelte component ts issue, typed correctly in external svelte files or plain ts/js)
    db = new pouchDB.plugin(findPlugin)(name)

    db.put({
      _id: '_design/conflicts',
      views: {
        conflicts: {
          map: function (doc) {
            if (doc._conflicts) {
              // @ts-ignore
              emit()
            }
          }.toString()
        }
      }
    }).catch(() => {})

    // arkype
  
    const sortOrder = ['archived', 'done', 'order']
    let filter = $state(null)
    db.createIndex({
      index: { fields: sortOrder }
    }).then(() => {
      filter = 'active'
    })
    $effect(() => {
      filter && refreshTodos({ activeFilter: filter })
    })

    let hasConflicts = false

    async function resolveConflicts() {
      const { rows: conflictDocs } = await db.query('conflicts', {
        include_docs: true,
        conflicts: true
      })

      for (const {doc: conflictDoc} of conflictDocs) {
        const conflicts = await Promise.all(conflictDoc._conflicts.map(rev => db.get(conflictDoc._id, {rev})))
        console.log('Conflicts found:', { conflictDoc, conflicts })
      }
    }

    let lastLocalSeq = $state(null)
    let changes = $state([])
    db.changes({
      live: true,
      since: 'now',
      filter: doc => !doc._id.startsWith('_design/')
    }).on('change', async change => {
      change.doc = await db.get(change.id, { revs_info: true, conflicts: true })
      const conflicts = change.doc._conflicts && await Promise.all(change.doc._conflicts.map(rev => db.get(change.doc._id, {rev})))
      const firstAvailableIndex = change.doc._revs_info.findIndex((rev, i) =>  i !== 0 && rev.status === 'available')
      const firstAvailableRev = change.doc._revs_info[firstAvailableIndex]?.rev

      delete change.doc._revs_info
      delete change.doc._conflicts
      change.conflicts = conflicts?.map(conflict => ({ left: jsonmergepatch.generate(change.doc, conflict), right: jsonmergepatch.generate(conflict, change.doc) })) 

      if (change.conflicts) {
        hasConflicts = true
      }

      const ancestor = firstAvailableRev && await db.get(change.doc._id, { rev: firstAvailableRev })
      if (ancestor) {
        if (firstAvailableIndex > 1) {
          change.skippedVersions = firstAvailableIndex - 1
        }
        change.diff = jsonmergepatch.generate(ancestor, change.doc)
      }

      const oldDoc = docs[change.id]

      lastLocalSeq = change.seq
      changes = [change, ...changes]
      

      // Prevent messing up editing text while getting updates. saving will raise conflict and can be handled by resolver
      if (editingId !== change.id) {
        docs[change.id] = change.doc

        for (const key of sortOrder) {
          if (!oldDoc || (oldDoc[key] !== change.doc[key])) {
            refreshTodos({ activeFilter: filter })
            break
          }        
        }
      }
    })

    const initialLoad = $state({})
    async function refreshTodos ({ activeFilter = null } = {}) {
      const { docs: newDocs } = await db.find({
        selector: {
          archived: activeFilter === 'archived',
          done: { $exists: true },
          order: { $exists: true },
        },
        fields: initialLoad ? undefined : ['_id'],
        sort: sortOrder,
        limit: 200
      })
      if (!initialLoad[activeFilter]) {
        for (const doc of newDocs) {
            docs[doc._id] = doc
        }
        initialLoad[activeFilter] = true
      }
      list = newDocs.reverse().map(doc => doc._id)
    }

    let syncDoc = $state({ _id: '_local/sync', last_seq: null, _rev: undefined })
    db.get('_local/sync').then(doc => syncDoc = doc).catch(() => {})
    let replication = null
    $effect(() => {
      if (replication) {
        replication.cancel()
        replication = null
      }

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

          if (hasConflicts && typeof remote !== 'string') {
            resolveConflicts()
          }
        })
      }
    })

    let unsyncedChanges = $derived((syncDoc.last_seq && lastLocalSeq) ? lastLocalSeq - syncDoc.last_seq : 0)
  
    let newTodo = $state('')
    function add () {
      const previousOrder = docs[list.at(-1)]?.order || 0
      db.post({ text: newTodo, done: false, archived: false, order: previousOrder - 1 })
      newTodo = ''
    }

    let dragging = $state(null)
    let dragover = $state(null)
    function move (moveAboveDoc, idToMove, index) {
      if (docs[idToMove].done !== moveAboveDoc.done) {
        return
      }

      let newOrder
      if ((index - 1) >= 0 && docs[list.at(index - 1)].done === moveAboveDoc.done) {
        newOrder = (docs[list.at(index - 1)].order + moveAboveDoc.order) / 2
      } else {
        newOrder = moveAboveDoc.order + 1
      }

      db.put({...docs[idToMove], order: newOrder})
    }

    async function handleKeyDown (e, doc) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.target.blur()
        return
      }

      const newText = e.target.value
      if (doc.text === newText) {
        return
      }

      if (e.target.value.includes('@auto')) {
        if (!crdts[doc._id]) {
          // We switch the text field to a crdt if the @auto demo keyword is encountered
          if (doc.automerge) {
            const attachment = await db.getAttachment(doc._id, 'automerge')
            const arrayBuffer = await attachment.arrayBuffer()
            crdts[doc._id] = automerge.load(new Uint8Array(arrayBuffer))
          } else {
            crdts[doc._id] = automerge.from({ text: newText })
          }
        }

        // Crdts need updates to their datastructures as often as possible, 
        // but the pouchdb sync should be used for bigger changes.
        // If a realtime text colaboration would be implemented you would also not use the document sync for keystrokes 
        // but instead use a realtime client stream for the keystrokes and combine that with the document sync for snapshotting and the final session persistence.
        crdts[doc._id] = automerge.change(crdts[doc._id], d => {
          automerge.updateText(d, ["text"], newText)
        })
      }
    }

    async function handleBlur (e, doc) {
      const newText = e.target.value
      if (doc.text === newText) {
        return
      }

      if (!e.target.value.includes('@auto') && crdts[doc._id]) {
        // Remove automerge handling if the keyword is removed
        doc.automerge = false
        delete crdts[doc._id]
        const { rev } = await db.removeAttachment(doc._id, 'automerge', doc._rev)
        db.put({ ...doc, _rev: rev, text: newText }, { force: true })
      } else if (crdts[doc._id]) {
        crdts[doc._id] = automerge.change(crdts[doc._id], d => {
          automerge.updateText(d, ["text"], newText)
        })
        db.put({ 
          ...doc,
          text: newText,
          _attachments: {
            automerge: {
              content_type: "application/octet-stream",
              data: new Blob([automerge.save(crdts[doc._id])], { type: 'application/octet-stream' })
            }
          }
        }, { force: true })
      } else {
        db.put({ ...doc, text: newText }, { force: true })
      }
    }

    onDestroy(() => {
      replication?.cancel()
      db.close()
    })

    let editingId = null
</script>
  
<article class:archived={filter !== 'active' || !initialLoad[filter]}>
    <header>
        <h2>
          User {name} 
          {#if unsyncedChanges > 0}
            <p class="slow">({unsyncedChanges} unsynced changes)</p>
          {/if}
        </h2>

        <button class="filter-button" class:hidden={!initialLoad[filter]} onmousedown={() => filter = (filter === 'active' ? 'archived' : 'active')}>{filter === 'active' ? 'Show Archived' : 'Show Active'}</button>
    </header>

    {#key filter}
      {#each list as id, i (id)}
        {@const doc = docs[id] || {}}
        
        <div
          class="todo"
          role="list"
          animate:flip={{ duration: 100 }}
          class:dragover={dragover === doc._id}
          ondrop={() => move(doc, dragging, i)}
          ondragend={() => { dragging=null; dragover = null}}
          draggable={dragging===doc._id}
          ondragover={e => { e.preventDefault(); dragover = doc._id}} >

            <input class="checkbox" type="checkbox" checked={doc.done} onchange={function () { db.put({...doc, done: this.checked}) }}>
            
            <input
              type="text"
              value={doc.text} 
              onfocus={() => { editingId =  doc._id }}
              onblur={e => { handleBlur(e, doc); editingId = null }}
              onkeydown={e => handleKeyDown(e, doc)}>
            
            <button class="delete" onmousedown={() => db.put({ ...doc, archived: true } )}>❌</button>
            
            <div 
              class="drag"
              role="button"
              tabindex=-1
              onmousedown={() => dragging=doc._id}
              onmouseup={() => {dragging=null; dragover = null}}>⠿</div>
        </div>
      {/each}
    {/key}
    
    <div class="add-todo">
      <input type="text" style="margin-left: 31px" placeholder="add todo" bind:value={newTodo} onkeydown={e => { e.key === 'Enter' && add()}}> 
      <button class="add" onmousedown={add}>Add</button>
    </div>

    {#if changes.length}
      <h3 style="margin-top: 21px;">Changes: <button onmousedown={() => changes = []}>clear</button></h3> 
    {/if}
  
    <ul>
      {#each changes as { doc, seq, diff, conflicts, skippedVersions }}
        <li>
          db seq: {seq}<br>
          id: {doc._id}
          {#if diff}
            {#if skippedVersions}(skipped {skippedVersions} obsolete changes){/if}
            <pre>diff: {JSON.stringify(diff, null, 2)}</pre>
          {:else}
            <pre>doc: {JSON.stringify(doc, null, 2)}</pre>
          {/if}


          {#if conflicts}
            <!-- <h3 style="margin-top: 21px;">Resolve:
              <button onmousedown={() => {}}>Left</button>
              <button onmousedown={() => {}}>Right</button>
              <button onmousedown={() => {}}>LWW</button>
              <button onmousedown={() => {}}>Application Logic</button>
            </h3>  -->
            <pre>conflicts: {JSON.stringify(conflicts, null, 2)}</pre>
          {/if}
        </li>
      {/each}
    </ul>
</article>
