<script>
    import { onDestroy } from 'svelte'
    import pouchDb from 'pouchdb-browser'

    let {
      name,
      initialDoc = null,
      remote = null,
      db = $bindable()
    } = $props()

    const dbPrefix = 'myDb4_'

    db = pouchDb(dbPrefix + name)

    let lastReplicationSeq = $state(0)
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
        }).on('change', ({ change }) => {
          console.log(change)
          lastReplicationSeq = change.last_seq
          // db.put({ _id: '_local/sync', last_seq: lastReplicationSeq })
        })

        console.log('syncing...', { remote, replication })
      }
    })
  
    let doc = $state({ text: '', count: 0 })
    db.get('demo').then(newDoc => {
      doc = newDoc
    }).catch((err) => {
      if (err.name === 'not_found' && initialDoc) {
        db.put(initialDoc)
      }
    })
  
    let lastLocalSeq = $state(0)
    let changes = $state([])
    db.changes({
      include_docs: true,
      conflicts: true,
      live: true,
      since: 'now',
      doc_ids: ['demo']
    }).on('change', (change) => {
      console.log(change)
      doc = change.doc
      lastLocalSeq = change.seq
      changes.push(change)
    })
  
    function updateLastSeen () {
      doc.lastSeen = Date.now()
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
        <h2>User {name} {#if lastLocalSeq - lastReplicationSeq}({lastLocalSeq - lastReplicationSeq} unsynced changes){/if}</h2>
    </header>

    <input type="text" value={doc.text} onblur={updateText}/>
    
    <div>
      <button onclick={updateLastSeen}>Click</button> last clicked: {doc.lastSeen}
    </div>

    {#if changes.length}
      <h3 style="margin-top: 21px;">Changes since start: <button onclick={() => changes = []}>clear</button></h3> 
    {/if}
  
    <ul>
      {#each changes as { doc, seq }}
        <li>db seq id: {seq}, text: "{doc.text}", last clicked: {doc.lastSeen}</li>
      {/each}
    </ul>
</article>
