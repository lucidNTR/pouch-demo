<script>
  import User from './User.svelte'

  let online = $state(true)
  let simulate = $state(true)
  let remoteUrl = $state('')
  let remoteDB = $state(null)

  const initialDoc = {
    _id: 'demo',
    text: 'Hello PouchDB!',
    count: 1
  }

  // add unsynced count
  // sync status
</script>

<main>
  <header style="display: flex; padding: 17px; justify-content: space-between;">
    <img src="/logo.svg" alt="pouchdb logo" style="height: 30px; margin: 0; padding-top: 5px;">
    
    <div>
      <button onclick={() => online = !online}>Go {online === true ? "offline" : "online"}</button>
      <button onclick={() => simulate = !simulate}>{simulate === true ? "Use Real Remote" : "Simulate Remote"}</button>
    </div>
  </header>

  <section>
    <User name="a" {initialDoc} remote={online ? (remoteUrl || remoteDB) : null} />
    
    {#if simulate}
      <User name="b" bind:db={remoteDB} />
    {:else}
      <article>
         <header> 
          <h3>Remote couchDB url:</h3>
        </header>

        <input type="text" bind:value={remoteUrl} placeholder="https://my-remote-couchdb/myDb">
      </article>
    {/if}
  </section>
</main>

<style>
 @media only screen and (min-width: 786px) {
    section {
      display: flex;
      align-items: flex-start;
    }
 }
</style>
