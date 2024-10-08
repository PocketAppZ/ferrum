<script lang="ts" context="module">
	import { writable } from 'svelte/store'

	export const modal_count = writable(0)
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte'
	import { check_shortcut } from '../lib/helpers'

	export let on_cancel: () => void
	export let cancel_on_escape = false
	export let form: (() => void) | undefined = undefined
	export let plain = false
	$: tag = form === undefined ? 'div' : 'form'
	export let title: string | null = null
	let dialog_el: HTMLDialogElement

	$modal_count += 1
	onDestroy(() => {
		$modal_count -= 1
	})

	onMount(() => {
		dialog_el.showModal()
		return () => {
			dialog_el.close()
		}
	})

	// Prevent clicks where the mousedown or mouseup happened on a child element. This could've
	// been solved with a non-parent backdrop element, but that interferes with text selection.
	let clickable = true
</script>

<svelte:body
	on:click={() => {
		clickable = true
	}}
/>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<dialog
	class="modal m-auto"
	bind:this={dialog_el}
	tabindex="-1"
	on:click|self={() => {
		if (clickable) {
			on_cancel()
		}
	}}
	on:keydown
	on:keydown={(e) => {
		if (check_shortcut(e, 'Escape') && cancel_on_escape) {
			on_cancel()
		}
	}}
	on:keydown|self={(e) => {
		if (form && check_shortcut(e, 'Enter')) {
			form()
			e.preventDefault()
		}
	}}
>
	<svelte:element
		this={tag}
		class="box"
		class:padded={!plain}
		on:submit|preventDefault={form}
		on:mousedown={() => {
			clickable = false
		}}
		on:mouseup={() => {
			clickable = false
		}}
		role="none"
	>
		{#if title !== null}
			<h3>{title}</h3>
		{/if}
		<slot />
		{#if $$slots.buttons}
			<div class="buttons">
				<slot name="buttons" />
			</div>
		{/if}
	</svelte:element>
</dialog>

<style lang="sass">
	h3
		margin-bottom: 15px
	::backdrop
		background-color: rgba(#000000, 0.4)
	dialog
		color: inherit
		box-sizing: border-box
		box-shadow: 0px 0px 30px 0px rgba(#000000, 0.5)
		background-color: rgba(#1b1d22, 75%)
		backdrop-filter: saturate(3) blur(20px) brightness(1.25)
		padding: 0
		border: 1px solid rgba(#ffffff, 0.2)
		border-radius: 7px
	.padded
		padding: 1em
	.buttons
		display: flex
		justify-content: flex-end
</style>
