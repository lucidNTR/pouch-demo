<script>
    import { onDestroy } from 'svelte'
    import pouchDb from 'pouchdb-browser'
    import findPlugin from 'pouchdb-find'
    pouchDb.plugin(findPlugin)

    let {
      name,
      initialDoc = null,
      remote = null,
      db = $bindable()
    } = $props()

    db = pouchDb(name, { prefix: 'demo3_' })
    db.createIndex({
      index: { fields: ['archived', 'done', 'order'] }
    })

    let lastLocalSeq = $state(null)
    let changes = $state([])
    db.changes({
      include_docs: true,
      conflicts: true,
      live: true,
      since: 'now'
    }).on('change', (change) => {
      doc = change.doc
      lastLocalSeq = change.seq
      changes.push(change)
    })

    let syncDoc = $state({ _id: '_local/sync', last_seq: null, _rev: undefined })
    db.get('_local/sync').then(doc => {
      syncDoc = doc
    }).catch(() => {})
    let unsyncedChanges = $derived((syncDoc.last_seq && lastLocalSeq) ? lastLocalSeq - syncDoc.last_seq : 0)

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
            syncDoc._rev = ( await db.put(syncDoc)).rev
          }
        })

        console.log('starting sync...', { remote, replication })
      }
    })
  
    let doc = $state({ text: '', done: false })
    db.get('demo').then(newDoc => {
      doc = newDoc
    }).catch((err) => {
      if (err.name === 'not_found' && initialDoc) {
        db.put(initialDoc)
      }
    })

    db.find({
      selector: {
        archived: { $eq: false }
      },
      sort: ['archived', 'done', 'order']
    })
  
    function updateDone ({target}) {
      doc.done = target.checked
      db.put(doc)
    }

    function updateText ({ target }) {
      if (doc.text !== target.value) {
        doc.text = target.value
        db.put(doc)
      }
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

    <div style="display: flex; align-items: center;">
      <input class="checkbox" type="checkbox" checked={doc.done} onchange={updateDone}>
      <input type="text" value={doc.text} onblur={updateText}>
    </div>

    <div style="display: flex; align-items: center;">
      <input type="text" style="margin-left: 31px" placeholder="add todo"> 
      <button class="add" onclick={add}>Add</button>
    </div>

    {#if changes.length}
      <h3 style="margin-top: 21px;">Changes since start: <button onmousedown={() => changes = []}>clear</button></h3> 
    {/if}
  
    <ul>
      {#each changes as { doc, seq }}
        <li>db seq: {seq}, text: "{doc.text}", done: {doc.done}</li>
      {/each}
    </ul>
</article>
