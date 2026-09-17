<script lang="ts">
  import type { TaskView } from './tasks';
  import IncidentBoard from './IncidentBoard.svelte';
  let {
    puzzle,
    disabled,
    submit,
    shared = false
  }: {
    puzzle: TaskView;
    disabled: boolean;
    submit: (answer: string, targetStep?: number) => void;
    shared?: boolean;
  } = $props();
  let selection = $state('');
  let current = $derived(puzzle.steps[puzzle.step]);
  let stepIndex = $derived(puzzle.step);
  $effect(() => {
    stepIndex;
    selection = '';
  });
</script>

<section class="mini-task" aria-label={puzzle.title}>
  <h3>{puzzle.title}</h3>
  {#if puzzle.kind !== 'incident'}
    <p>{puzzle.instructions}</p>
    <div class="task-progress" role="status">
      {puzzle.step} of {puzzle.steps.length} steps saved
    </div>
    <progress
      max={puzzle.steps.length}
      value={puzzle.step}
      aria-label={shared ? 'Shared repair progress' : 'Ticket progress'}
    ></progress>
  {/if}
  {#if current}
    {#if puzzle.kind === 'incident'}
      <IncidentBoard {puzzle} {disabled} {submit} />
    {:else if puzzle.kind === 'sequence'}
      <ol class="runbook">
        {#each puzzle.steps as step, index}
          <li
            class:accepted={index < puzzle.step}
            aria-current={index === puzzle.step ? 'step' : undefined}
          >
            {step.label}{index < puzzle.step ? ' ✓' : ''}
          </li>
        {/each}
      </ol>
      <div class="operation-list">
        {#each current.options as option}
          <button
            class="secondary"
            disabled={disabled ||
              puzzle.steps.slice(0, puzzle.step).some((s) => s.label === option)}
            onclick={() => submit(option)}>{option}</button
          >
        {/each}
      </div>
    {:else if puzzle.kind === 'matching'}
      <div class="criterion">
        <small>ACCEPTANCE CRITERION {puzzle.step + 1}</small>
        <p>{current.label}</p>
      </div>
      <div class="operation-list">
        {#each current.options as option}
          <button class="secondary" {disabled} onclick={() => submit(option)}
            >Attach to: {option}</button
          >
        {/each}
      </div>
    {:else}
      <ol class="runbook">
        {#each puzzle.steps.slice(0, puzzle.step) as step}<li class="accepted">
            {step.label} ✓
          </li>{/each}
      </ol>
      <div class="control-panel">
        <strong>{current.label}</strong>
        <div class="settings" role="group" aria-label={current.label}>
          {#each current.options as option}
            <button
              class="secondary"
              aria-pressed={selection === option}
              {disabled}
              onclick={() => (selection = option)}>{option}</button
            >
          {/each}
        </div>
        <button class="primary" disabled={disabled || !selection} onclick={() => submit(selection)}
          >Apply setting</button
        >
      </div>
    {/if}
  {/if}
  <p class="muted">
    {shared
      ? 'Progress is shared for this outage. Esc closes the repair panel.'
      : 'Accepted steps are saved. Esc closes this ticket.'}
  </p>
</section>

<style>
  h3 {
    margin-bottom: 8px;
  }
  .task-progress {
    font-size: 12px;
    color: #b8a6e8;
  }
  progress {
    width: 100%;
    height: 8px;
    accent-color: #b8a6e8;
  }
  .runbook {
    padding-left: 22px;
    line-height: 1.8;
    font-size: 13px;
  }
  .accepted {
    color: #92c5a9;
  }
  [aria-current='step'] {
    color: #fcd34d;
  }
  .operation-list {
    display: grid;
    gap: 8px;
    margin: 18px 0;
  }
  .operation-list button {
    text-align: left;
  }
  .criterion,
  .control-panel {
    padding: 18px;
    margin: 16px 0;
    background: #202631;
    border: 1px solid #515c6c;
    border-radius: 8px;
  }
  .criterion small {
    color: #b8a6e8;
  }
  .settings {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 16px 0;
  }
  [aria-pressed='true'] {
    outline: 2px solid #b8a6e8;
    background: #40335b;
  }
</style>
