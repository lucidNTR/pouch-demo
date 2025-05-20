<script>
    import pouchDb from 'pouchdb-browser'

    let { name, initialDoc, remote } = $props()

    const db = pouchDb('myDb_' + name)
  
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
      doc = change.doc
      changes.push(change)
    })
  
    function counter () {
      doc.count += 1
      db.put(doc)
    }
    function updateText ({ target }) {
      doc.text = target.value
      db.put(doc)
    }
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
        <li>text: {doc.text} count: {doc.count}</li> 
        <!-- revision: {doc._rev} db squence id: {seq} -->
      {/each}
    </ul>
</article>