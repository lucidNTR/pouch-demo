<script>
  import User from './User.svelte'

  let online = $state(true)
</script>


<button on:click={() => online = !online}>Go {online === true ? "offline" : "online"}</button>

<User name="a" />

<User name="b" />
