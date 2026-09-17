<script lang="ts">
  import type { TaskView } from './tasks';

  let {
    puzzle,
    disabled,
    submit
  }: {
    puzzle: TaskView;
    disabled: boolean;
    submit: (answer: string, targetStep: number) => void;
  } = $props();
  let selected = $state('');
  let hover = $state(-1);
  let incidentId = $derived(puzzle.id);
  let progress = $derived(puzzle.step);
  const clues = [
    'New jobs keep sending the broken release. Stop incoming work first.',
    'The failed release is still deployed. Remove it once incoming work has stopped.',
    'Service recovery is unverified. Test it after removing the failed release.'
  ];
  const recovered = ['Pipeline paused', 'Bad deployment cleared', 'Health verified'];
  const actions = ['Pause pipeline', 'Clear bad deployment', 'Run health check'];
  $effect(() => {
    incidentId;
    progress;
    selected = '';
    hover = -1;
  });
  function place(action: string, stage: number) {
    if (disabled || stage < puzzle.step || !actions.includes(action)) return;
    selected = '';
    hover = -1;
    submit(action, stage);
  }
</script>

<div class="incident-board" aria-label="Shared incident board" aria-busy={disabled}>
  <div
    class="recovery-progress"
    role="status"
    aria-label={`Recovery progress: ${puzzle.step} of ${puzzle.steps.length} stages resolved`}
  >
    <div class="recovery-progress-copy">
      <strong>Recovery progress</strong>
      <span class="recovery-count">{puzzle.step} / {puzzle.steps.length} stages resolved</span>
    </div>
    <div class="progress-segments" aria-hidden="true">
      {#each puzzle.steps as _, index}
        <span class:resolved={index < puzzle.step}></span>
      {/each}
    </div>
  </div>
  <p class="diagnostic">
    <strong>Deployment failed at Deploy.</strong> Recover the stages below in order.
  </p>
  <section class="pipeline-trace" aria-labelledby="pipeline-status-label">
    <div class="section-label" id="pipeline-status-label">Pipeline status</div>
    <ol class="pipeline">
      <li class="complete" aria-label="Commit complete">
        <span class="node">✓</span><strong>Commit</strong><small>Complete</small>
      </li>
      <li class="complete" aria-label="Build complete">
        <span class="node">✓</span><strong>Build</strong><small>Complete</small>
      </li>
      <li class="complete" aria-label="Test complete">
        <span class="node">✓</span><strong>Test</strong><small>Complete</small>
      </li>
      <li
        class:failed={puzzle.step < 2}
        class:complete={puzzle.step >= 2}
        aria-label={puzzle.step < 2 ? 'Deploy failed' : 'Deploy cleared'}
      >
        <span class="node">{puzzle.step < 2 ? '!' : '✓'}</span><strong>Deploy</strong><small
          >{puzzle.step < 2 ? 'Failed' : 'Cleared'}</small
        >
      </li>
      <li class="pending" aria-label="Health waiting">
        <span class="node">•</span><strong>Health</strong><small>Waiting</small>
      </li>
    </ol>
  </section>
  <div class="section-label" id="recovery-actions-label">Recovery actions</div>
  <div class="actions" role="group" aria-labelledby="recovery-actions-label">
    {#each puzzle.steps[0].options as action}
      <button
        class="secondary"
        draggable={!disabled && actions.indexOf(action) >= puzzle.step}
        disabled={disabled || actions.indexOf(action) < puzzle.step}
        aria-pressed={selected === action}
        onclick={() => (selected = selected === action ? '' : action)}
        ondragstart={(event) => {
          selected = action;
          event.dataTransfer?.setData('text/plain', action);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
        ondragend={() => (hover = -1)}
        >{action}{actions.indexOf(action) < puzzle.step ? ' ✓' : ''}</button
      >
    {/each}
  </div>
  <div class="section-label" id="recovery-stages-label">Recovery stages</div>
  <div class="stages" role="group" aria-labelledby="recovery-stages-label">
    {#each puzzle.steps as stage, index}
      <button
        class="stage"
        class:resolved={index < puzzle.step}
        class:current={index === puzzle.step}
        class:over={hover === index}
        disabled={disabled || index < puzzle.step}
        aria-label={`Place action on ${stage.label}`}
        onclick={() => place(selected, index)}
        ondragover={(event) => {
          if (!disabled && index >= puzzle.step) {
            event.preventDefault();
            hover = index;
          }
        }}
        ondragleave={() => (hover = -1)}
        ondrop={(event) => {
          event.preventDefault();
          place(event.dataTransfer?.getData('text/plain') ?? '', index);
        }}
      >
        <strong>{index + 1}. {stage.label}</strong>
        <span class="clue">{clues[index]}</span>
        <span class="slot"
          >{index < puzzle.step
            ? `✓ ${recovered[index]}`
            : selected
              ? `Place: ${selected}`
              : 'Select or drop recovery action'}</span
        >
        <small
          >{index < puzzle.step
            ? 'Saved for everyone'
            : index === puzzle.step
              ? 'Ready for recovery'
              : 'Requires previous stage'}</small
        >
      </button>
    {/each}
  </div>
  <p class="hint" role="status">
    {disabled
      ? 'Checking recovery…'
      : selected
        ? `${selected} selected. Choose its destination.`
        : 'Any active colleague can place the next action. Health verification restores CI.'}
  </p>
</div>

<style>
  .incident-board {
    display: grid;
  }
  .section-label {
    margin-bottom: 12px;
    color: #929eb0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
  .pipeline-trace {
    margin: 0 0 18px;
    padding: 14px 16px 16px;
    border: 1px solid #3e4858;
    border-radius: 8px;
    background: #1b222d;
  }
  .pipeline {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .pipeline li {
    position: relative;
    display: grid;
    place-items: center;
    gap: 3px;
    min-width: 0;
    text-align: center;
  }
  .pipeline li:not(:last-child)::after {
    position: absolute;
    z-index: 0;
    top: 11px;
    left: calc(50% + 14px);
    width: calc(100% - 28px);
    height: 2px;
    background: #515c6c;
    content: '';
  }
  .pipeline .node {
    z-index: 1;
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 2px solid currentColor;
    border-radius: 50%;
    background: #1b222d;
    font-size: 12px;
    font-weight: 800;
  }
  .pipeline strong {
    overflow: hidden;
    max-width: 100%;
    font-size: 12px;
    text-overflow: ellipsis;
  }
  .pipeline small {
    color: currentColor;
    font-size: 10px;
  }
  .pipeline .complete {
    color: #92c5a9;
  }
  .pipeline .failed {
    color: #ffb3c4;
  }
  .pipeline .pending {
    color: #fcd34d;
  }
  .diagnostic {
    margin: 16px 0;
    font-size: 13px;
    color: #c3cbd8;
  }
  .diagnostic strong {
    color: #ffb3c4;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 18px;
  }
  .actions button {
    font-size: 12px;
    padding: 9px;
  }
  [aria-pressed='true'] {
    outline: 2px solid #c4b5fd;
    background: #40335b;
  }
  .stages {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .stage {
    display: grid;
    gap: 8px;
    text-align: left;
    background: #202631;
    border: 1px solid #515c6c;
    padding: 12px;
    color: #eef1f6;
  }
  .stage.current {
    border-color: #fcd34d;
  }
  .stage.over {
    outline: 2px solid #c4b5fd;
    background: #40335b;
  }
  .stage.resolved {
    opacity: 1;
    border-color: #547e6e;
    color: #a7e2c5;
  }
  .clue,
  .hint,
  small {
    font-size: 12px;
    font-weight: normal;
  }
  .clue {
    color: #c3cbd8;
  }
  .slot {
    border: 1px dashed #738199;
    border-radius: 4px;
    padding: 8px;
    font-size: 12px;
  }
  .resolved .slot {
    border-style: solid;
  }
  .hint {
    color: #c4b5fd;
    margin: 0;
  }
  .recovery-progress {
    margin: 0;
  }
  .recovery-progress-copy {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .recovery-count {
    color: #b8a6e8;
  }
  .progress-segments {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .progress-segments span {
    height: 8px;
    border: 1px solid #596579;
    border-radius: 3px;
    background: #29313d;
  }
  .progress-segments .resolved {
    border-color: #759f8c;
    background: #759f8c;
  }
  @media (max-height: 820px) {
    .section-label {
      margin-bottom: 8px;
    }
    .diagnostic {
      margin: 12px 0;
    }
    .pipeline-trace {
      margin-bottom: 12px;
      padding: 10px 14px 12px;
    }
    .actions {
      margin-bottom: 12px;
    }
    .stages {
      gap: 8px;
      margin-bottom: 12px;
    }
    .stage {
      gap: 6px;
      padding: 10px;
    }
  }
  @media (max-width: 600px) {
    .stages {
      grid-template-columns: 1fr;
    }
    .recovery-progress-copy {
      align-items: start;
      flex-direction: column;
      gap: 3px;
    }
  }
</style>
