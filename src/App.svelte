<script>
  import User from './User.svelte'

  let online = $state(true)
  let simulate = $state(true)
  let remoteUrl = $state('')
  let remoteDB = $state({})

</script>

<main>
  <button onclick={() => online = !online}>Go {online === true ? "offline" : "online"}</button>
  <button onclick={() =>  simulate = !simulate}>{simulate === true ? "Use Real Remote" : "Simulate Remote"}</button>

  <User name="a" />

  
  {#if simulate}
    <User name="b" remote={online ? (reomoteUrl || remoteDB) : null} />
  {:else}
    <article>
      <input type="text" value={remoteUrl} placeholder="https://my-remote-couchdb/myDb">
    </article>
  {/if}
</main>