<script>
    import pouchDb from 'pouchdb-browser'

    let props = $props()

    const db = new pouchDb('myDb_' + props.name)
  
    let doc = $state({})
  
    db.get('myDoc').then(newDoc => {
      doc = newDoc
    })
  
    db.put({ _id: 'myDoc', text: 'Hello PouchDB!', count: 1 })
  
    let changes = $state([])
    db.changes({ include_docs: true, live: true, since: 'now' }).on('change', (change) => {
      changes.push(change)
    })
  
    function counter () {
      db.post({ text: 'PouchDB!', count: 1 })
    }
  </script>
  
  <article>
    <header>
        <h2>User {props.name}</h2>
    </header>

    
    <input type="text" value={doc.text} />
    
    <div>
      <button on:click={counter}>Counter</button> count: {doc.count}
    </div>

    {#if changes.length}
      Changes since start:
    {/if}
  
    <ul>
      {#each changes as {doc, seq}}
        <li>text: {doc.text} count: {doc.count}</li> 
        <!-- revision: {doc._rev} db squence id: {seq} -->
      {/each}
    </ul>
</article>