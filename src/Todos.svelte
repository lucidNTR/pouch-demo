<script>
    import { onDestroy } from 'svelte'
    import { flip } from 'svelte/animate'
    import pouchDb from 'pouchdb-browser'
    import findPlugin from 'pouchdb-find'
    // @ts-ignore
    pouchDb.plugin(findPlugin)

    const sortOrder = ['archived', 'done', 'order']

    let {
      name,
      remote = null,
      db = $bindable()
    } = $props()

    let list = $state([])
    let docs = $state({})
    db = pouchDb(name, { prefix: 'demo_' })
    db.createIndex({
      index: { fields: sortOrder },
    }).then(() => {
      refreshTodos({ include_docs: true })
    })

    let lastLocalSeq = $state(null)
    let changes = $state([])
    db.changes({
      include_docs: true,
      conflicts: true,
      live: true,
      since: 'now'
    }).on('change', (change) => {
      const oldDoc = docs[change.doc._id]
      const newDoc = change.doc

      let refreshList = false
      for (const key of sortOrder) {
        if (!oldDoc || (oldDoc[key] !== newDoc[key])) {
          refreshList = true
          break
        }        
      }

      docs[change.doc._id] = newDoc
      lastLocalSeq = change.seq
      changes = [change, ...changes]
      if (refreshList) {
        refreshTodos()
      }
    })

    async function refreshTodos ({ include_docs = false } = {}) {
      const { docs: newDocs } = await db.find({
        selector: {
          archived: false,
          done: { $exists: true },
          order: { $exists: true },
        },
        fields: include_docs ? undefined : ['_id'],
        sort: sortOrder,
        limit: 200
      })
      list = []
      for (const doc of newDocs.reverse()) {
        list.push(doc._id)
        if (include_docs) {
          docs[doc._id] = doc
        }
      }
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
          retry: true
        })
        replication.push.on('paused', async (err) => {          
          if (!err) {
            syncDoc.last_seq = (await db.info()).update_seq
            syncDoc._rev = (await db.put(syncDoc)).rev
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
      let newOrder
      if ((index - 1) >= 0) {
        const moveBelowId = list.at(index - 1)
        const moveBelowDoc = docs[moveBelowId]

        newOrder = (moveBelowDoc.order + moveAboveDoc.order) / 2
      } else {
        newOrder = moveAboveDoc.order + 1
      }

      db.put({...docs[idToMove], order: newOrder})
    }

    onDestroy(() => {
      replication?.cancel()
      db.close()
    })
</script>
  
<article>
    <header>
        <h2>
          User {name} 
          {#if unsyncedChanges > 0}
            <p class="slow">({unsyncedChanges} unsynced changes)</p>
          {/if}
        </h2>
    </header>

    {#each list as id, i (id)}
      {@const doc = docs[id]}
      
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
          
          <input type="text" value={doc.text} onblur={function () {(doc.text !== this.value) && db.put({ ...doc, text: this.value })  }}>
          
          <button class="delete" onmousedown={() => db.put({ ...doc, archived: true } )}>❌</button>
          
          <div 
            class="drag"
            role="button"
            tabindex=-1
            onmousedown={() => dragging=doc._id}
            onmouseup={() => {dragging=null; dragover = null}}>⠿</div>
      </div>
    {/each}
    
    <div style="display: flex; align-items: center;">
      <input type="text" style="margin-left: 31px" placeholder="add todo" bind:value={newTodo} onkeydown={e => { e.key === 'Enter' && add()}}> 
      <button class="add" onmousedown={add}>Add</button>
    </div>

    {#if changes.length}
      <h3 style="margin-top: 21px;">Last 3 Changes: <button onmousedown={() => changes = []}>clear</button></h3> 
    {/if}
  
    <ul>
      {#each changes.slice(0,3) as { doc, seq }}
        <li>db seq: {seq}, text: "{doc.text}", done: {doc.done}, order: {doc.order}</li>
      {/each}
    </ul>
</article>
