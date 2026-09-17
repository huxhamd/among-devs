<script lang="ts">
  import { FIXTURE_TYPES, type Fixture } from './office';
  let { fixture }: { fixture: Fixture } = $props();
</script>

<g
  class="office-fixture"
  data-fixture-id={fixture.id}
  data-kind={fixture.kind}
  data-blocking={fixture.blocking}
  transform={`translate(${fixture.x},${fixture.y})`}
  pointer-events="none"
>
  <title>{FIXTURE_TYPES[fixture.kind].name} · {fixture.blocking ? 'solid' : 'passable'}</title>
  {#if fixture.blocking}
    <rect x="3" y="5" width={fixture.w} height={fixture.h} rx="5" fill="#0b111b" opacity=".4" />
  {/if}
  {#if fixture.kind === 'plant'}
    <ellipse cx="18" cy="29" rx="15" ry="6" fill="#101822" opacity=".4" />
    <path d="M8 20H28L25 34H11Z" fill="#b48262" stroke="#d1a383" />
    <path d="M18 26V9" stroke="#79a787" stroke-width="3" />
    <ellipse cx="10" cy="14" rx="7" ry="11" transform="rotate(-40 10 14)" fill="#497e69" />
    <ellipse cx="26" cy="13" rx="7" ry="11" transform="rotate(40 26 13)" fill="#6aa48a" />
    <ellipse cx="18" cy="9" rx="6" ry="9" fill="#8bb69a" />
  {:else if fixture.kind === 'printer'}
    <rect x="9" y="0" width="26" height="18" rx="1" fill="#c7cfce" />
    <path d="M14 5H30M14 9H26" stroke="#81919d" />
    <rect y="12" width="44" height="25" rx="4" fill="#84949e" stroke="#b2bfc4" />
    <rect x="7" y="25" width="30" height="10" rx="2" fill="#25333e" />
    <path d="M12 30H32V40H12Z" fill="#c7cfce" />
    <circle cx="36" cy="19" r="2" fill="#8ad4b1" />
  {:else if fixture.kind === 'chair'}
    <path d="M16 16V30M5 29H27" stroke="#83909f" stroke-width="3" />
    <rect x="4" y="6" width="24" height="19" rx="7" fill="#53647d" stroke="#7d8ea7" />
    <rect x="3" y="1" width="26" height="8" rx="4" fill="#687c97" />
  {:else if fixture.kind === 'board'}
    <rect width="120" height="32" rx="3" fill="#a8baba" stroke="#637582" stroke-width="3" />
    <path d="M10 9H50M10 16H38M64 9H105M64 17H96" stroke="#4e7073" stroke-width="2" />
    <path d="M80 27H104" stroke="#b98477" stroke-width="3" />
  {:else if fixture.kind === 'bookcase'}
    <rect width="110" height="36" rx="2" fill="#685945" stroke="#b09976" stroke-width="2" />
    {#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as book}
      <rect
        x={7 + book * 10}
        y="6"
        width="7"
        height={book % 3 === 0 ? 21 : 25}
        fill={['#8eaaa4', '#c39d75', '#8e95b2', '#b97f79'][book % 4]}
      />
    {/each}
    <path d="M3 32H107" stroke="#c0a57e" stroke-width="3" />
  {:else if fixture.kind === 'rack'}
    <rect width="76" height="100" rx="4" fill="#1b2931" stroke="#6a8c8d" stroke-width="2" />
    {#each [0, 1, 2, 3] as unit}
      <rect x="7" y={8 + unit * 22} width="62" height="17" rx="2" fill="#354b54" />
      <path d={`M14 ${16 + unit * 22}H46`} stroke="#79959d" stroke-width="2" />
      <circle cx="60" cy={16 + unit * 22} r="2" fill="#80baa5" />
    {/each}
  {:else if fixture.kind === 'sofa'}
    <rect width="110" height="48" rx="9" fill="#4b6970" stroke="#819a9b" stroke-width="2" />
    <rect x="12" y="12" width="40" height="28" rx="5" fill="#62818a" />
    <rect x="58" y="12" width="40" height="28" rx="5" fill="#62818a" />
    <path d="M8 9H102M8 9V38M102 9V38" fill="none" stroke="#91a6a6" stroke-width="3" />
  {:else if fixture.kind === 'counter'}
    <rect width="160" height="54" rx="4" fill="#b1a387" stroke="#d0c3a8" stroke-width="2" />
    <rect
      x="12"
      y="9"
      width="52"
      height="33"
      rx="7"
      fill="#566771"
      stroke="#d2d5ca"
      stroke-width="2"
    />
    <path d="M35 9V22H45" stroke="#c1cbc7" stroke-width="3" fill="none" />
    <rect x="92" y="11" width="47" height="30" rx="3" fill="#82775e" />
    <circle cx="115" cy="26" r="10" fill="#c3b391" />
  {:else}
    <rect
      width={fixture.w}
      height={fixture.h}
      rx={fixture.kind === 'table' ? 18 : 5}
      fill="#81705c"
      stroke="#b09a7b"
      stroke-width="2"
    />
    {#if fixture.kind === 'desk'}
      <rect x="30" y="6" width="50" height="26" rx="3" fill="#26323f" stroke="#94a3ab" />
      <path d="M38 15H61M38 21H71" stroke="#729b9e" stroke-width="2" />
      <rect x="35" y="37" width="40" height="10" rx="2" fill="#b1b7b4" />
      <circle cx="94" cy="36" r="6" fill="#d3c6ab" /><circle cx="94" cy="36" r="3" fill="#5b493e" />
    {:else}
      <rect
        x="32"
        y="18"
        width="26"
        height="34"
        rx="2"
        transform="rotate(-12 45 35)"
        fill="#bbbba9"
      />
      <path d="M94 24H127V47H94Z" fill="#43576a" stroke="#9da9ad" />
      <circle cx="76" cy="60" r="6" fill="#c0ab89" />
    {/if}
  {/if}
</g>
