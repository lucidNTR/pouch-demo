<script>
    import { onDestroy } from 'svelte'
    import pouchDb from 'pouchdb-browser'

    let {
      name,
      initialDoc = null,
      remote = null,
      db = $bindable()
    } = $props()

    db = pouchDb('myDb1_' + name)

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

        console.log('syncing...', {remote, replication})
      }
    })
  
    let doc = $state({ text: '', count: 0 })
    db.get('demo').then(newDoc => {
      doc = newDoc
    }).catch(() => {
      if (initialDoc) {
        db.put(initialDoc)
      }
    })
  
    let changes = $state([])
    db.changes({ include_docs: true, live: true, since: 'now', doc_ids: ['demo'] }).on('change', (change) => {
      console.log(change)
      doc = change.doc
      changes.push(change)
    })
  
    function counter () {
      doc.count += 1
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
      db.destroy()
    })
</script>
  
<article>
    <header>
        <h2>User {name}</h2>
    </header>

    <input type="text" value={doc.text} onblur={updateText}/>
    
    <div>
      <button onclick={counter}>Counter</button> count: {doc.count}
    </div>

    {#if changes.length}
      <h3 style="margin-top: 21px;">Changes since start:</h3>
    {/if}
  
    <ul>
      {#each changes as {doc, seq}}
        <li>db seq id: {seq}, text: "{doc.text}", count: {doc.count}</li> 
        <!-- revision: {doc._rev} -->
      {/each}
    </ul>
</article>
