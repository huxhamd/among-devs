<script lang="ts">
  type DestinationKind = 'workstation' | 'ci' | 'standup';

  let {
    kind,
    x,
    baseY,
    iconY,
    baseWidth = 118,
    active = true,
    urgent = false,
    muted = false,
    showIcon = true
  }: {
    kind: DestinationKind;
    x: number;
    baseY: number;
    iconY: number;
    baseWidth?: number;
    active?: boolean;
    urgent?: boolean;
    muted?: boolean;
    showIcon?: boolean;
  } = $props();

  const colours: Record<DestinationKind, string> = {
    workstation: '#c3b6ff',
    ci: '#5eead4',
    standup: '#e9c98b'
  };
  let colour = $derived(urgent ? '#f0808f' : colours[kind]);
</script>

<g
  class="destination-marker"
  class:active
  class:urgent
  class:muted
  data-destination={kind}
  style={`--destination-accent: ${colour}`}
  pointer-events="none"
  aria-hidden="true"
>
  <ellipse
    class="destination-beacon"
    cx={x}
    cy={baseY}
    rx={baseWidth / 2}
    ry="16"
  />
  {#if showIcon}
    <g transform={`translate(${x},${iconY})`}>
      <g class="destination-icon-motion">
        <path class="destination-pointer" d="M-4 14L0 21L4 14Z" />
        <circle class="destination-icon-disc" r="16" />
        {#if kind === 'workstation'}
          <rect class="destination-icon-line" x="-9" y="-7" width="18" height="12" rx="2" />
          <path class="destination-icon-line" d="M0 5V9M-6 9H6" />
        {:else if kind === 'ci'}
          <text class="destination-icon-text" y="4">CI</text>
        {:else}
          <circle class="destination-icon-fill" cx="-6" cy="-4" r="2.5" />
          <circle class="destination-icon-fill" cy="-6" r="3" />
          <circle class="destination-icon-fill" cx="6" cy="-4" r="2.5" />
          <path class="destination-icon-line" d="M-10 7Q-6 2-2 7M-5 8Q0 1 5 8M2 7Q6 2 10 7" />
        {/if}
      </g>
    </g>
  {/if}
</g>

<style>
  .destination-marker {
    color: var(--destination-accent);
    transition: opacity 180ms ease;
  }

  .destination-marker.muted {
    opacity: 0.5;
  }

  .destination-beacon {
    fill: var(--destination-accent);
    opacity: 0.2;
    filter: blur(5px);
    transform-box: fill-box;
    transform-origin: center;
  }

  .destination-icon-motion {
    color: var(--destination-accent);
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--destination-accent) 65%, transparent));
    transform-box: fill-box;
    transform-origin: center;
  }

  .destination-marker.active .destination-beacon {
    animation: destination-breathe 2.4s ease-in-out infinite;
  }

  .destination-marker.active .destination-icon-motion {
    animation: destination-float 2.4s ease-in-out infinite;
  }

  .destination-marker.urgent .destination-beacon,
  .destination-marker.urgent .destination-icon-motion {
    animation-duration: 1.45s;
  }

  .destination-pointer {
    fill: #17212b;
    stroke: currentColor;
    stroke-width: 1.5;
  }

  .destination-icon-disc {
    fill: #17212b;
    stroke: currentColor;
    stroke-width: 2;
  }

  .destination-icon-line {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .destination-icon-fill {
    fill: currentColor;
  }

  .destination-icon-text {
    fill: currentColor;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-anchor: middle;
  }

  @keyframes destination-breathe {
    0%,
    100% {
      opacity: 0.24;
      transform: scale(0.92);
    }
    50% {
      opacity: 0.58;
      transform: scale(1.08);
    }
  }

  @keyframes destination-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-5px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .destination-marker.active .destination-beacon,
    .destination-marker.active .destination-icon-motion {
      animation: none;
    }

    .destination-marker.active .destination-beacon {
      opacity: 0.48;
    }
  }
</style>
