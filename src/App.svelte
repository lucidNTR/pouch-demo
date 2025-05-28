<script>
  import { marked } from 'marked'
  import Todos from './Todos.svelte'
  import readme from '../README.md?raw'

  let online = $state(true)
  let simulate = $state(true)
  let remoteUrl = $state('https://pouch.lanes.pm/_couch/jj-pouch-demo')
  let remoteDB = $state(null)
</script>

<main>
  <header style="display: flex; padding: 17px; justify-content: space-between;">
    <img src="/logo.svg" alt="pouchdb logo" style="height: 30px; margin: 0; padding-top: 5px;">
    
    <div style="text-align: right;">
      <button onmousedown={() => online = !online}>Go {online === true ? "Offline" : "Online"}</button>
      <button onmousedown={() => simulate = !simulate}>{simulate === true ? "Real Remote" : "Simulate Remote"}</button>
    </div>
  </header>

  <details style="margin: 1rem;">
    <summary>Readme</summary>
    <div style="max-height: 450px; overflow: auto;">
      {@html marked(readme)}
    </div>
  </details>

  <section>
    <Todos name="a" remote={online ? (simulate ? remoteDB : remoteUrl) : null} />
    
    {#if simulate}
      <Todos name="b" bind:db={remoteDB} />
    {:else}
      <article>
         <header> 
          <h3>Remote couchDB url:</h3>
        </header>

        <input type="text" value={remoteUrl} placeholder="https://my-remote-couchdb/myDb" onblur={function () { remoteUrl = this.value }}>
      </article>
    {/if}
  </section>
</main>
