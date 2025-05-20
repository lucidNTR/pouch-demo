<script>
    import pouchDb from 'pouchdb-browser'

    let props = $props()

    const db = new pouchDb('myDb_' + props.name)
  
    let doc = $state({})
  
    db.get('myDoc').then(newDoc => {
      doc = newDoc
    })
  
  
    db.put({ _id: 'myDoc', text: 'PouchDB!', count: 1 })
  
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
    <div>
        Hello {doc.text} {doc.count}
    </div>
  
    <div class="mt-2">
      <button on:click={counter}>Counter</button>
    </div>

    Changes since start:
  
    <ul>
    {#each changes as {doc}}
      <li>text: {doc.text} count: {doc.count}</li>
    {/each}
    </ul>

</article>