<script>
    import { onDestroy } from 'svelte'
    import pouchDb from 'pouchdb-browser'
    import findPlugin from 'pouchdb-find'
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
      console.log(change)
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

    function refreshTodos ({ include_docs = false } = {}) {
      db.find({
        selector: {
          archived: false,
          done: { $exists: true },
          order: { $exists: true },
        },
        fields: include_docs ? undefined : ['_id'],
        sort: sortOrder,
        limit: 200
      }).then(({ docs: newDocs }) => {
        list = []
        for (const doc of newDocs.reverse()) {
          list.push(doc._id)
          include_docs && (docs[doc._id] = doc)
        }
      })
    }

    let syncDoc = $state({ _id: '_local/sync', last_seq: null, _rev: undefined })
    db.get('_local/sync').then(doc => {
      syncDoc = doc
    }).catch(() => {})

    let replication = null
    $effect(() => {
      if (replication) {
        replication.cancel()
        replication = null
        console.log('cancelling sync...')
      }

      if (remote) {
        replication = db.sync(remote, {
          live: true,
          retry: true
        })
        replication.push.on('paused', async (err) => {
          console.log('synced', { err })
          
          if (!err) {
            syncDoc.last_seq = (await db.info()).update_seq
            syncDoc._rev = (await db.put(syncDoc)).rev
          }
        })

        console.log('starting sync...', { remote, replication })
      }
    })

    let unsyncedChanges = $derived((syncDoc.last_seq && lastLocalSeq) ? lastLocalSeq - syncDoc.last_seq : 0)
  
    let newTodo = $state('')
    function add () {
      db.post({ text: newTodo, done: false, archived: false, order: 10 })
      newTodo = ''
    }

    onDestroy(() => {
      replication?.cancel()
      db.close()
    })
</script>
  
<article>
    <header>
        <h2>User {name} {#if unsyncedChanges > 0}({unsyncedChanges} unsynced changes){/if}</h2>
    </header>

    {#each list as id (id)}
      {@const doc = docs[id]}
      
      <div style="display: flex; align-items: center;">
        <input class="checkbox" type="checkbox" checked={doc.done} onchange={({ target }) => db.put({...doc, done: target.checked})}>
        <input type="text" value={doc.text} onblur={({ target }) => doc.text !== newText && db.put({ ...doc, text: newText })}>
      </div>
    {/each}
    
    <div style="display: flex; align-items: center;">
      <input type="text" style="margin-left: 31px" placeholder="add todo" bind:value={newTodo}> 
      <button class="add" onclick={add}>Add</button>
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
