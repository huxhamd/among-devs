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
  {#if puzzle.kind === 'incident'}
    {#if current}
      <IncidentBoard {puzzle} {disabled} {submit} />
    {/if}
  {:else}
    <p class="task-instructions">{puzzle.instructions}</p>
    {#if current}
      <section class="task-workbench" aria-label="Ticket workbench">
        <div class="workbench-progress" role="status">
          <span class="progress-label">Progress</span>
          <strong class="task-progress">
            {puzzle.step} / {puzzle.steps.length} steps complete
          </strong>
        </div>
        <div
          class="task-progress-segments"
          style:grid-template-columns={`repeat(${puzzle.steps.length}, minmax(0, 1fr))`}
          aria-hidden="true"
        >
          {#each puzzle.steps as _, index}
            <span class:complete={index < puzzle.step}></span>
          {/each}
        </div>

        {#if puzzle.kind === 'sequence'}
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
            <button
              class="primary"
              disabled={disabled || !selection}
              onclick={() => submit(selection)}>Apply setting</button
            >
          </div>
        {/if}
      </section>
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
    margin: 0 0 8px;
  }
  .task-instructions {
    margin-bottom: 20px;
  }
  .task-workbench {
    margin: 20px 0;
    padding: 18px;
    border: 1px solid #465164;
    border-radius: 10px;
    background: #171e28;
    box-shadow: inset 0 1px 0 #ffffff08;
  }
  .workbench-progress {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .progress-label {
    color: #929eb0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
  .task-progress {
    font-size: 12px;
    font-weight: 600;
    color: #b8a6e8;
  }
  .task-progress-segments {
    display: grid;
    gap: 6px;
    margin: 9px 0 18px;
  }
  .task-progress-segments span {
    height: 8px;
    border: 1px solid #596579;
    border-radius: 3px;
    background: #29313d;
  }
  .task-progress-segments .complete {
    border-color: #759f8c;
    background: #759f8c;
  }
  .runbook {
    padding-left: 22px;
    margin: 0 0 18px;
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
    margin: 18px 0 0;
  }
  .operation-list button {
    text-align: left;
  }
  .criterion,
  .control-panel {
    padding: 18px;
    margin: 0;
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
  .mini-task > .muted {
    margin-bottom: 0;
  }
  @media (min-width: 601px) {
    .operation-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-height: 820px) {
    h3 {
      margin-bottom: 4px;
    }
    .task-instructions {
      margin: 8px 0 12px;
    }
    .task-workbench {
      margin: 12px 0;
      padding: 14px;
    }
    .task-progress-segments {
      margin: 7px 0 12px;
    }
    .runbook {
      margin-bottom: 12px;
      line-height: 1.6;
    }
    .operation-list {
      gap: 6px;
      margin-top: 12px;
    }
    .criterion,
    .control-panel {
      padding: 14px;
    }
    .settings {
      margin: 12px 0;
    }
    .mini-task > .muted {
      margin-top: 12px;
    }
  }
  @media (max-width: 600px) {
    .task-workbench {
      padding: 14px;
    }
    .workbench-progress {
      align-items: start;
      flex-direction: column;
      gap: 3px;
    }
  }
</style>
