<script>
  import pouchDb from 'pouchdb-browser'
  const db = new pouchDb('my_db')

  db.put({ _id: 'myDoc', text: 'PouchDB!', count: 1 })

  let changes = []

  function counter () {

  }
</script>

<main>
  <div>
    {#await db.get('myDoc') then doc}
      Hello {doc.text} {doc.count}
    {/await}
  </div>

  <div class="mt-2">
    <button on:click={counter}>Counter</button>
  </div>
</main>

<aside>
  Changes:
  
  {#each changes as {doc}}
    text: {doc.hello} count: {doc.count}
  {/each}
</aside>
