<script lang="ts">
  import { onMount } from 'svelte';
  import MiniTask from '$lib/MiniTask.svelte';
  import OfficeFixture from '$lib/OfficeFixture.svelte';
  import DestinationMarker from '$lib/DestinationMarker.svelte';
  import { fade } from 'svelte/transition';
  import { io, type Socket } from 'socket.io-client';
  import { PositionInterpolator, type InterpolatedPosition } from '$lib/interpolation';
  import { canSee, lightPolygon } from '$lib/visibility';
  import {
    CI_CONSOLE,
    CUPBOARD_REACH,
    ACCESS_REACH,
    STATIONS,
    WALLS,
    FIXTURES,
    OFFICE_ZONES,
    PAGES,
    EXITS,
    VISIBILITY_RADIUS,
    pageAt,
    atCiConsole,
    nearestWithin,
    type Snapshot,
    type Action,
    type Reply
  } from '$lib/shared';
  import '../style.css';

  let socket: Socket;
  let name = $state('');
  let code = $state('');
  let session = $state<Snapshot | null>(null);
  let renderedPositions = $state<Record<string, InterpolatedPosition>>({});
  let connected = $state(false);
  let busy = $state(false);
  let error = $state('');
  type ToastNotice = { id: number; message: string; duration: number };
  let notice = $state<ToastNotice | null>(null);
  let noticePaused = $state(false);
  let stationId = $state('');
  let taskPending = $state(false);
  let taskError = $state('');
  // Local playtest counters only: no names, roles, answers, or network telemetry.
  const taskMetrics: Record<
    string,
    { activeMs: number; attempts: number; failures: number; completions: number }
  > = {};
  function metric(id: string) {
    return (taskMetrics[id] ??= { activeMs: 0, attempts: 0, failures: 0, completions: 0 });
  }
  function saveTaskMetrics() {
    try {
      sessionStorage.setItem('among-devs-task-metrics', JSON.stringify(taskMetrics));
    } catch {
      /* Storage is optional. */
    }
  }
  let copied = $state(false);
  let help = $state(false);
  const keys = new Set<string>();
  const noticePauseReasons = new Set<'pointer' | 'focus'>();
  const NOTICE_DURATION = 4000;
  const GUIDANCE_DURATION = 8000;
  const movement = new PositionInterpolator();
  let noticeId = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeStartedAt = 0;
  let noticeRemaining = 0;
  let saved: { name: string; code: string; token: string } | null = null;
  let me = $derived(session?.players.find((p) => p.id === session?.self));
  let inRound = $derived(!!session && session.phase !== 'lobby' && session.phase !== 'ended');
  let currentPage = $derived((me && pageAt(renderedPositions[me.id] ?? me)) || PAGES[0]);
  let lightPosition = $derived(me ? (renderedPositions[me.id] ?? me) : undefined);
  let limitedVision = $derived(session?.phase === 'work' && me?.active);
  let cupboardUse = $derived(session?.cupboard);
  let accessUse = $derived(session?.access);
  let travelling = $derived(accessUse?.phase === 'travelling');
  let interactionLocked = $derived(!!cupboardUse || !!accessUse);
  let nearbyAccess = $derived(
    session?.role === 'tester' && me?.active && !interactionLocked
      ? session.accessPanels?.find((a) => canSee(me, a, ACCESS_REACH))
      : undefined
  );
  let accessLabel = $derived(
    accessUse
      ? accessUse.phase === 'entering'
        ? 'Entering access panel…'
        : travelling
          ? 'Travelling through maintenance route…'
          : 'Exiting access panel…'
      : 'Use access panel • E'
  );
  function useAccess() {
    if (!nearbyAccess || interactionLocked) return;
    keys.clear();
    act({ type: 'access', id: nearbyAccess.id });
  }
  let hidden = $derived(cupboardUse?.phase === 'hidden');
  let visionRadius = $derived(travelling ? 0 : hidden ? VISIBILITY_RADIUS / 2 : VISIBILITY_RADIUS);
  let nearbyCupboard = $derived(
    session?.role === 'tester' && me?.active && !accessUse
      ? session.cupboards?.find((c) => canSee(me, c, CUPBOARD_REACH))
      : undefined
  );
  let cupboardLabel = $derived(
    cupboardUse
      ? hidden
        ? 'Leave cupboard • E'
        : `${cupboardUse.phase === 'entering' ? 'Entering' : 'Exiting'} cupboard…`
      : 'Hide in cupboard • E'
  );
  let cupboardPrompt = $derived(hidden ? 'E • Leave cupboard' : 'E • Hide in cupboard');
  function useCupboard() {
    const id = cupboardUse?.id ?? nearbyCupboard?.id;
    if (!id || (cupboardUse && !hidden)) return;
    keys.clear();
    act({ type: 'cupboard', id });
  }
  let lightPoints = $derived(
    limitedVision && lightPosition
      ? lightPolygon(lightPosition, visionRadius)
          .map((point) => `${point.x},${point.y}`)
          .join(' ')
      : ''
  );
  let repairing = $derived(stationId === 'ci');
  let station = $derived(
    repairing
      ? { id: 'ci', name: 'Repair CI', room: 'CI Control Console' }
      : STATIONS.find((s) => s.id === stationId)
  );
  let currentPuzzle = $derived(repairing ? session?.repair : session?.puzzles[stationId]);
  let nearby = $derived(
    me && !interactionLocked
      ? STATIONS.find(
          (s) => pageAt(s)?.id === pageAt(me)?.id && Math.hypot(s.x - me.x, s.y - me.y) <= 80
        )
      : undefined
  );
  let atTable = $derived(
    me && !interactionLocked ? Math.hypot(me.x - 500, me.y - 310) <= 80 : false
  );
  let atConsole = $derived(me && !interactionLocked ? atCiConsole(me) : false);
  let target = $derived(
    me && session && !interactionLocked
      ? nearestWithin(
          me,
          session.players.filter((p) => p.visible && p.active && p.id !== me.id),
          65
        )
      : undefined
  );
  let report = $derived(
    session?.phase === 'work' && me?.active && !interactionLocked
      ? session.players.find(
          (p) =>
            p.visible && !p.active && !p.reported && me && Math.hypot(p.x - me.x, p.y - me.y) <= 80
        )
      : undefined
  );
  let seconds = $derived(
    session
      ? Math.max(
          0,
          Math.ceil(
            ((session.phase === 'role-reveal'
              ? session.roleRevealDeadline
              : (session.meeting?.deadline ??
                session.meetingResult?.deadline ??
                session.deadline)) -
              session.now) /
              1000
          )
        )
      : 0
  );
  let cooldown = $derived(
    session ? Math.max(0, Math.ceil((session.cooldown - session.now) / 1000)) : 0
  );
  let sabotageCooldown = $derived(
    session ? Math.max(0, Math.ceil((session.sabotageReady - session.now) / 1000)) : 0
  );
  let eligibleTrainingTarget = $derived(
    session?.phase === 'work' &&
      session.role === 'tester' &&
      session.players.length > 3 &&
      me?.active
      ? target
      : undefined
  );
  let trainingTarget = $derived(cooldown === 0 ? eligibleTrainingTarget : undefined);
  let trainingCooldownTarget = $derived(
    cooldown > 0 && !report && !nearby && !atTable && !atConsole
      ? eligibleTrainingTarget
      : undefined
  );

  function dismissNotice(expectedId?: number) {
    if (expectedId !== undefined && notice?.id !== expectedId) return;
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
    noticePauseReasons.clear();
    noticePaused = false;
    notice = null;
  }
  function startNoticeTimer() {
    if (!notice || noticePaused) return;
    const expectedId = notice.id;
    noticeStartedAt = Date.now();
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => dismissNotice(expectedId), noticeRemaining);
  }
  function showNotice(message: string, duration = NOTICE_DURATION) {
    clearTimeout(noticeTimer);
    noticePauseReasons.clear();
    noticePaused = false;
    noticeRemaining = duration;
    notice = { id: ++noticeId, message, duration };
    startNoticeTimer();
  }
  function pauseNotice(reason: 'pointer' | 'focus') {
    if (!notice || noticePauseReasons.has(reason)) return;
    noticePauseReasons.add(reason);
    if (noticePaused) return;
    noticeRemaining = Math.max(0, noticeRemaining - (Date.now() - noticeStartedAt));
    clearTimeout(noticeTimer);
    noticeTimer = undefined;
    noticePaused = true;
  }
  function resumeNotice(reason: 'pointer' | 'focus') {
    noticePauseReasons.delete(reason);
    if (!notice || noticePauseReasons.size > 0 || !noticePaused) return;
    noticePaused = false;
    if (noticeRemaining <= 0) dismissNotice(notice.id);
    else startNoticeTimer();
  }

  function enter(join: boolean, resume = false) {
    if (!connected || busy) return;
    error = '';
    busy = true;
    socket
      .timeout(7000)
      .emit(
        'enter',
        resume && saved ? saved : { name, ...(join ? { code } : {}) },
        (timeout: Error | null, reply: Reply) => {
          busy = false;
          if (timeout || reply.error) {
            error = timeout ? 'The workspace did not respond. Please retry.' : reply.error!;
            if (resume) {
              saved = null;
              sessionStorage.removeItem('among-devs-seat');
              session = null;
            }
            return;
          }
          saved = {
            name: resume && saved ? saved.name : name,
            code: reply.code!,
            token: reply.token!
          };
          sessionStorage.setItem('among-devs-seat', JSON.stringify(saved));
        }
      );
  }
  function act(action: Action) {
    error = '';
    socket.timeout(5000).emit('action', action, (timeout: Error | null, reply: Reply) => {
      if (timeout || reply.error)
        error = timeout ? 'Connection interrupted. Try again.' : reply.error!;
    });
  }
  function submitTask(answer: string, targetStep?: number) {
    const puzzle = currentPuzzle;
    if (!puzzle || taskPending || !connected) return;
    taskPending = true;
    taskError = '';
    const submittedStation = stationId;
    metric(submittedStation).attempts++;
    socket.timeout(5000).emit(
      'action',
      (repairing
        ? { type: 'repair', puzzle: puzzle.id, step: targetStep ?? puzzle.step, answer }
        : {
            type: 'task',
            station: stationId,
            puzzle: puzzle.id,
            step: puzzle.step,
            answer
          }) satisfies Action,
      (timeout: Error | null, reply: Reply) => {
        taskPending = false;
        if ((timeout || reply.error) && stationId === submittedStation)
          taskError = timeout ? 'Connection interrupted. Retry this step.' : reply.error!;
        if (
          reply?.error?.includes('refinement') ||
          reply?.error?.includes('recovery action') ||
          reply?.error?.includes('current stage')
        )
          metric(submittedStation).failures++;
        saveTaskMetrics();
      }
    );
  }
  function openRepair() {
    if (!connected || session?.phase !== 'work' || !session.repair || !me?.active || !atConsole)
      return;
    stationId = 'ci';
    taskError = '';
    keys.clear();
  }
  function openTask() {
    if (session?.incident) {
      showNotice(
        'CI is down. Go to the CI Control Console at the top of the central office and press E to repair CI.',
        GUIDANCE_DURATION
      );
      return;
    }
    if (nearby) {
      if (session?.completed.includes(nearby.id)) {
        showNotice('Ticket already closed.');
        return;
      }
      stationId = nearby.id;
      taskError = '';
      keys.clear();
    }
  }
  function focusDialog(node: HTMLDivElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = [...node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener('keydown', trap);
    return {
      destroy() {
        node.removeEventListener('keydown', trap);
        previous?.focus();
      }
    };
  }
  function leave() {
    sessionStorage.removeItem('among-devs-seat');
    saved = null;
    socket.disconnect();
    session = null;
    movement.reset();
    renderedPositions = {};
    busy = false;
    socket.connect();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(session!.code);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      error = 'Copy the workspace code shown above.';
    }
  }
  onMount(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('among-devs-task-metrics') || '{}');
      for (const station of [...STATIONS, { id: 'ci' }]) {
        const value = stored[station.id];
        if (
          value &&
          ['activeMs', 'attempts', 'failures', 'completions'].every(
            (key) => Number.isFinite(value[key]) && value[key] >= 0
          )
        )
          taskMetrics[station.id] = value;
      }
    } catch {
      /* Start fresh if local metrics are unavailable. */
    }
    try {
      saved = JSON.parse(sessionStorage.getItem('among-devs-seat') || 'null');
      if (saved) {
        name = saved.name;
        code = saved.code;
      }
    } catch {
      sessionStorage.removeItem('among-devs-seat');
    }
    socket = io();
    socket.on('connect', () => {
      connected = true;
      error = '';
      if (saved) enter(true, true);
    });
    socket.on('disconnect', () => {
      connected = false;
      busy = false;
      keys.clear();
      movement.reset();
      renderedPositions = {};
    });
    socket.on('connect_error', () => {
      connected = false;
      error = 'Cannot connect to the workspace. Retrying…';
    });
    socket.on('state', (next: Snapshot) => {
      const arrivalAt = performance.now();
      if (next.phase === 'work') {
        const previousSelf = session?.players.find((p) => p.id === next.self);
        const nextSelf = next.players.find((p) => p.id === next.self);
        if (
          session?.phase !== 'work' ||
          (previousSelf &&
            nextSelf &&
            Math.hypot(nextSelf.x - previousSelf.x, nextSelf.y - previousSelf.y) > 100)
        )
          movement.reset();
        movement.addSnapshot(next.players, next.now, arrivalAt);
        renderedPositions = movement.positions(arrivalAt);
      } else {
        movement.reset();
        renderedPositions = {};
      }
      const ciRestored = session?.incident && !next.incident && next.phase === 'work';
      session = next;
      if (repairing && (!next.repair || !next.players.find((p) => p.id === next.self)?.active)) {
        if (ciRestored) {
          metric('ci').completions++;
          saveTaskMetrics();
          showNotice('CI restored. Tickets are available again.');
        }
        stationId = '';
      }
      if (stationId && next.completed.includes(stationId)) {
        metric(stationId).completions++;
        saveTaskMetrics();
        stationId = '';
        showNotice('Ticket closed. Please resist adding scope.');
      }
      if (next.phase !== 'work') {
        stationId = '';
        keys.clear();
      }
    });
    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const key = event.key.toLowerCase();
      // Arrow keys scroll the ticket list when it has keyboard focus.
      if (
        key.startsWith('arrow') &&
        event.target instanceof HTMLElement &&
        event.target.closest('.task-details')
      )
        return;
      if (
        ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key) &&
        session?.phase === 'work' &&
        !stationId &&
        !help
      ) {
        event.preventDefault();
        keys.add(key);
      }
      if (key === 'escape') {
        stationId = '';
        help = false;
      }
      if (
        key === 'b' &&
        !event.repeat &&
        connected &&
        session?.phase === 'work' &&
        !stationId &&
        !help &&
        session.role === 'tester' &&
        !interactionLocked &&
        me?.active &&
        !session.incident &&
        sabotageCooldown === 0
      ) {
        event.preventDefault();
        act({ type: 'sabotage' });
      }
      if (
        key === 't' &&
        !event.repeat &&
        connected &&
        session?.phase === 'work' &&
        !stationId &&
        !help &&
        session.role === 'tester' &&
        session.players.length > 3 &&
        me?.active &&
        target &&
        cooldown === 0
      ) {
        event.preventDefault();
        act({ type: 'sideline', target: target.id });
      }
      if (
        key === 'e' &&
        !event.repeat &&
        connected &&
        session?.phase === 'work' &&
        !stationId &&
        !help
      ) {
        if (accessUse || nearbyAccess) {
          event.preventDefault();
          useAccess();
        } else if (cupboardUse || nearbyCupboard) {
          event.preventDefault();
          useCupboard();
        } else if (report && me?.active) {
          act({ type: 'report' });
        } else if (atConsole) {
          if (session.incident && me?.active) openRepair();
          else if (session.incident)
            showNotice('An active colleague must repair CI.', GUIDANCE_DURATION);
          else if (session.role === 'tester' && me?.active) {
            if (sabotageCooldown) showNotice(`Break CI will be ready in ${sabotageCooldown}s.`);
            else act({ type: 'sabotage' });
          } else showNotice('CI operational.');
        } else if (atTable && me?.active) {
          if (!session.meetingsLeft) showNotice('You have no standups remaining.');
          else if (session.incident)
            showNotice('CI is down. Repair CI before calling a standup.', GUIDANCE_DURATION);
          else act({ type: 'meeting' });
        } else openTask();
      }
    };
    const up = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    const clear = () => keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    const animateMovement = (now: number) => {
      if (session?.phase === 'work')
        renderedPositions = movement.positions(now, !motionPreference.matches);
      animationFrame = requestAnimationFrame(animateMovement);
    };
    animationFrame = requestAnimationFrame(animateMovement);
    let lastTaskTick = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      if (
        connected &&
        session?.phase === 'work' &&
        stationId &&
        (!session.incident || repairing) &&
        !document.hidden
      ) {
        metric(stationId).activeMs += Math.min(100, now - lastTaskTick);
        saveTaskMetrics();
      }
      lastTaskTick = now;
      if (!connected || session?.phase !== 'work' || stationId || help || interactionLocked) return;
      const dx =
        Number(keys.has('d') || keys.has('arrowright')) -
        Number(keys.has('a') || keys.has('arrowleft'));
      const dy =
        Number(keys.has('s') || keys.has('arrowdown')) -
        Number(keys.has('w') || keys.has('arrowup'));
      if (dx || dy) socket.emit('action', { type: 'move', dx, dy });
    }, 50);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(animationFrame);
      clearTimeout(noticeTimer);
      socket.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  });
</script>

<svelte:head
  ><title>Among Devs — The sprint is suspicious</title><meta
    name="description"
    content="A private team workspace. Close tickets. Question everything."
  /></svelte:head
>

<div class="app-shell" class:in-round={inRound}>
  <header>
    <a class="brand" href="/" aria-label="Among Devs home"
      ><span class="brand-icon">a<span>.</span></span> among<span class="brand-light">devs</span
      ><span class="badge">SPRINT ZERO</span></a
    >
    <div class="header-actions">
      <span class:offline={!connected} class="connection"
        ><i></i>{connected ? 'Workspace online' : 'Connecting…'}</span
      ><button
        class="quiet"
        onclick={() => {
          help = true;
          keys.clear();
        }}>How it works ↗</button
      >
    </div>
  </header>

  {#if !session}
    <main class="welcome">
      <section class="intro">
        <div class="eyebrow"><span></span> YOUR NEXT STANDUP HAS A PLOT TWIST</div>
        <h1>Same team.<br />Different <em>agendas.</em></h1>
        <p class="lede">
          A few tickets. One suspicious colleague.<br />Ship the sprint before someone makes it<br
            class="desktop"
          /> everyone else’s problem.
        </p>
        <div class="facts">
          <span>◷ &nbsp; 4–6 minute rounds</span><span>♧ &nbsp; 3–10 colleagues</span><span
            >◉ &nbsp; Bring your Teams call</span
          >
        </div>
        <div class="office-preview" aria-hidden="true">
          <div class="preview-grid"></div>
          <div class="desk desk-one">⌨<small>definitely working</small></div>
          <div class="desk desk-two">☕<small>critical infrastructure</small></div>
          <div class="mini-person purple"><span>?</span></div>
          <div class="mini-person mint"></div>
          <div class="mini-person peach"></div>
          <span class="sticky">It passed<br />on my machine.</span><span class="preview-caption"
            >THE OFFICE · SOMEWHERE BETWEEN PLANNING & PANIC</span
          >
        </div>
      </section>
      <section class="entry-card">
        <div class="card-top">
          <span class="eyebrow">LET’S CALL THIS TEAM BUILDING</span><span>↗</span>
        </div>
        <h2>Clock in.</h2>
        <p>Your colleagues are only mildly suspicious.</p>
        <label for="name">YOUR DISPLAY NAME</label><input
          id="name"
          bind:value={name}
          maxlength="20"
          autocomplete="nickname"
          placeholder="e.g. Definitely not QA"
        />
        <button
          class="primary wide"
          disabled={!connected || busy || !name.trim()}
          onclick={() => enter(false)}
          >{busy ? 'Opening workspace…' : 'Create a workspace'} <span>→</span></button
        >
        <div class="divider"><span>or join your team</span></div>
        <label for="code">WORKSPACE CODE</label>
        <div class="join-row">
          <input
            id="code"
            bind:value={code}
            maxlength="6"
            autocomplete="off"
            spellcheck="false"
            placeholder="ABC123"
            oninput={() => (code = code.toUpperCase())}
            onkeydown={(e) => {
              if (e.key === 'Enter' && code.length === 6 && name.trim()) enter(true);
            }}
          /><button
            class="secondary"
            disabled={!connected || busy || code.length !== 6 || !name.trim()}
            onclick={() => enter(true)}>Join →</button
          >
        </div>
        <div class="entry-note">⌑ &nbsp; Private by code. No account. No calendar invite.</div>
      </section>
    </main>
  {:else}
    <main class="workspace">
      <div class="workspace-heading">
        <div>
          <div class="eyebrow">
            {session.phase === 'lobby'
              ? 'THE CALM BEFORE THE SPRINT'
              : 'A PERFECTLY NORMAL WORKDAY'}
          </div>
          <h1>
            {session.phase === 'lobby'
              ? 'The team is assembling.'
              : session.phase === 'ended'
                ? 'That’s a wrap.'
                : session.phase === 'meeting' || session.phase === 'meeting-result'
                  ? 'Let’s take this offline.'
                  : 'Operation: ship it.'}
          </h1>
        </div>
        <div class="workspace-tools">
          <div class="code-box">
            <small>WORKSPACE CODE</small><button onclick={copy}
              >{session.code} <span>{copied ? '✓' : '⧉'}</span></button
            >
          </div>
          {#if inRound}<button class="quiet" onclick={leave}>← Leave workspace</button>{/if}
        </div>
      </div>
      {#if !connected}<div class="banner danger">
          Connection lost. Reconnecting to your seat… You have 60 seconds.
        </div>{/if}
      {#if session.phase === 'lobby'}
        <div class="lobby-layout">
          <section class="panel">
            <div class="panel-heading">
              <h2>The usual suspects</h2>
              <span>{session.players.length} / 10</span>
            </div>
            <div class="people-grid">
              {#each session.players as person}<div class="person-card">
                  <div class="avatar" style:--person={person.color}>⌐</div>
                  <strong>{person.name}</strong><small
                    >{person.id === session.host ? 'HOST · ' : ''}{person.connected
                      ? 'Clocked in'
                      : 'Reconnecting…'}</small
                  >
                </div>{/each}{#each Array(Math.max(0, 3 - session.players.length)) as _}<div
                  class="person-card empty"
                >
                  <span>+</span><small>Waiting for a colleague</small>
                </div>{/each}
            </div>
            <div class="lobby-bottom">
              <span
                >{session.players.length < 3
                  ? `${3 - session.players.length} more to start the sprint.`
                  : 'Everyone here? Let the questionable decisions begin.'}</span
              >{#if me?.id === session.host}<button
                  class="primary"
                  disabled={session.players.length < 3 || session.players.some((p) => !p.connected)}
                  onclick={() => act({ type: 'start' })}>Start sprint →</button
                >{:else}<span class="badge">WAITING FOR HOST</span>{/if}
            </div>
          </section>
          <aside class="panel briefing">
            <div class="eyebrow">YOUR SPRINT BRIEF</div>
            <h2>Trust the process.<br />Question the people.</h2>
            <p><b>Devs</b> close all four tickets each, or vote the tester onto training.</p>
            <p>
              <b>The tester</b> delays the release by breaking CI and sending nearby devs on training.
            </p>
            <p>
              <b>Standups</b> are your chance to discuss on Teams and cast a vote here. Ties and skips
              send nobody away.
            </p>
            <div class="tip">
              With 3 people, training actions are disabled. The tester must run out the clock.
            </div>
            <small
              >Stay quiet about your role. If you go on training, keep doing your tickets and save
              the commentary for the end.</small
            >
          </aside>
        </div>
      {:else if session.phase === 'ended'}
        <section class="panel results">
          <div class="result-icon">
            {session.winner === 'dev' ? '✓' : session.winner === 'tester' ? '…' : '↻'}
          </div>
          <div class="eyebrow">SPRINT RETROSPECTIVE</div>
          <h2>
            {session.winner === 'dev'
              ? 'Against all odds, shipped.'
              : session.winner === 'tester'
                ? 'Moved to the next sprint.'
                : 'Let’s regroup.'}
          </h2>
          <p>{session.result}</p>
          <div class="result-stats">
            <span><b>{session.progress}/{session.total}</b> tickets closed</span><span
              ><b>{session.players.length}</b> questionable alibis</span
            >
          </div>
          {#if me?.id === session.host}<button
              class="primary"
              onclick={() => act({ type: 'reset' })}>Back to lobby →</button
            >{:else}<p>Waiting for the host to open the next sprint.</p>{/if}
        </section>
      {:else}
        <div class="game-hud">
          <div class="status-strip">
            <div class:tester={session.role === 'tester'} class="role-tag">
              YOU ARE {session.role === 'tester' ? 'THE TESTER' : 'A DEV'}{!me?.active
                ? ' · ON TRAINING'
                : ''}
            </div>
            <div class="release">
              <span>RELEASE READINESS <b>{session.progress}/{session.total}</b></span>
              <div class="progress">
                <i style:width={`${session.total ? (session.progress / session.total) * 100 : 0}%`}
                ></i>
              </div>
            </div>
            <div class="timer">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              <small
                >{session.phase === 'meeting'
                  ? 'TO VOTE'
                  : session.phase === 'meeting-result'
                    ? session.meetingResult?.continues
                      ? 'TO RESUME'
                      : 'TO FINISH'
                    : 'TO DEADLINE'}</small
              >
            </div>
          </div>
          <div class:offline={session.incident} class="ci-banner">
            <div
              class:active={!session.incident}
              class="ci-banner-message online"
              role="status"
              aria-hidden={session.incident}
            >
              <span class="ci-banner-icon" aria-hidden="true">✓</span>
              <div class="ci-banner-copy">
                <strong>CI operational</strong><span>Tickets can proceed.</span>
              </div>
            </div>
            <div
              class:active={session.incident}
              class="ci-banner-message outage"
              role="alert"
              aria-hidden={!session.incident}
            >
              <span class="ci-banner-icon" aria-hidden="true">!</span>
              <div class="ci-banner-copy">
                <strong>CI is down · {session.repair?.step ?? 0}/3 repair steps saved</strong><span
                  >Go to the CI Control Console at the top of the central office and press E to
                  repair CI. An active colleague must restore CI before tickets can continue.</span
                >
              </div>
            </div>
          </div>
        </div>
        {#if session.result}<div class="banner">{session.result}</div>{/if}
        {#if session.phase === 'meeting'}
          <section class="panel meeting">
            <div class="eyebrow">EMERGENCY STANDUP · CALLED BY {session.meeting?.caller}</div>
            <h2>Who’s blocking the release?</h2>
            <p>
              Discuss on Teams, then vote. A submitted vote is final. Missing votes count as skips.
            </p>
            <div class="vote-grid">
              {#each session.players.filter((p) => p.active) as person}<button
                  class="vote-card"
                  disabled={!me?.active || session.meeting?.yourVote !== null}
                  onclick={() => act({ type: 'vote', target: person.id })}
                  ><div class="avatar" style:--person={person.color}>⌐</div>
                  <strong>{person.name}</strong><small
                    >{session.meeting?.votes.includes(person.id)
                      ? 'Vote submitted ✓'
                      : person.connected
                        ? 'Considering the evidence…'
                        : 'Disconnected'}</small
                  ></button
                >{/each}
            </div>
            <button
              class="secondary"
              disabled={!me?.active || session.meeting?.yourVote !== null}
              onclick={() => act({ type: 'vote', target: 'skip' })}
              >Skip · insufficient evidence</button
            >
            <p class="muted">
              {!me?.active
                ? 'Training attendees observe. Please stay quiet on Teams.'
                : session.meeting?.yourVote
                  ? 'Your vote is in. Awaiting the team’s questionable judgement.'
                  : 'Roles are revealed at the end of the sprint.'}
            </p>
          </section>
        {:else}
          <div class="play-layout">
            <section class="map-panel">
              <svg
                viewBox={`${currentPage.x} ${currentPage.y} 1000 620`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Office map. Move using WASD or arrow keys. Press E at a workstation for tickets, at the central table to call a standup, or at the top-centre CI Control Console to repair or break CI. Testers can press B anywhere to break CI or T near a colleague to send them on training."
              >
                <defs
                  ><pattern id="floor" width="40" height="40" patternUnits="userSpaceOnUse"
                    ><rect width="40" height="40" fill="#202631" /><path
                      d="M40 0H0V40"
                      fill="none"
                      stroke="#2a303b"
                      stroke-width="1"
                    /></pattern
                  >
                  <radialGradient
                    id="visibility-light"
                    gradientUnits="userSpaceOnUse"
                    cx={lightPosition?.x ?? 0}
                    cy={lightPosition?.y ?? 0}
                    r={visionRadius}
                  >
                    <stop offset="0%" stop-color="black" stop-opacity="1" />
                    <stop offset="65%" stop-color="black" stop-opacity="1" />
                    <stop offset="85%" stop-color="black" stop-opacity="0.6" />
                    <stop offset="100%" stop-color="black" stop-opacity="0" />
                  </radialGradient>
                  <clipPath id="visibility-area" clipPathUnits="userSpaceOnUse">
                    <polygon points={lightPoints} />
                  </clipPath>
                  <clipPath id="room-bounds" clipPathUnits="userSpaceOnUse">
                    <rect x={currentPage.x} y={currentPage.y} width="1000" height="620" />
                  </clipPath>
                  <clipPath id="visibility-radius" clipPathUnits="userSpaceOnUse">
                    <circle
                      cx={lightPosition?.x ?? 0}
                      cy={lightPosition?.y ?? 0}
                      r={visionRadius}
                    />
                  </clipPath>
                  <mask
                    id="visibility-mask"
                    maskUnits="userSpaceOnUse"
                    x={currentPage.x}
                    y={currentPage.y}
                    width="1000"
                    height="620"
                    style="mask-type: luminance"
                  >
                    <rect
                      x={currentPage.x}
                      y={currentPage.y}
                      width="1000"
                      height="620"
                      fill="white"
                    />
                    <polygon points={lightPoints} fill="url(#visibility-light)" />
                  </mask>
                  <radialGradient id="player-glow">
                    <stop offset="0%" stop-color="#ffe4a3" stop-opacity="0.32" />
                    <stop offset="40%" stop-color="#ffe4a3" stop-opacity="0.16" />
                    <stop offset="100%" stop-color="#ffe4a3" stop-opacity="0" />
                  </radialGradient>
                </defs>
                <g clip-path="url(#room-bounds)">
                  <rect
                    x={currentPage.x}
                    y={currentPage.y}
                    width="1000"
                    height="620"
                    fill="url(#floor)"
                  />
                  <rect
                    x={currentPage.x + 20}
                    y={currentPage.y + 20}
                    width="960"
                    height="580"
                    rx="12"
                    fill={currentPage.color}
                    opacity=".6"
                  />
                  {#each OFFICE_ZONES.filter((zone) => zone.page === currentPage.id) as zone}
                    <rect
                      x={zone.x}
                      y={zone.y}
                      width={zone.w}
                      height={zone.h}
                      rx="8"
                      fill={currentPage.color}
                      stroke="#a6b4c0"
                      stroke-opacity=".12"
                    />
                    <text
                      x={zone.x + 12}
                      y={zone.y + 18}
                      fill="#aebdca"
                      opacity=".55"
                      font-size="10"
                      letter-spacing="1.5">{zone.label}</text
                    >
                  {/each}
                  {#each FIXTURES.filter((fixture) => pageAt(fixture)?.id === currentPage.id) as fixture (fixture.id)}
                    <OfficeFixture {fixture} />
                  {/each}
                  {#each EXITS.filter((exit) => exit.from === currentPage.id) as exit}
                    {@const localX = exit.x - currentPage.x}
                    {@const localY = exit.y - currentPage.y}
                    {@const label = exit.vertical ? exit.label.replace(/[←→]/u, '↑') : exit.label}
                    {@const labelX = exit.vertical ? exit.x + (localX === 0 ? 35 : -35) : exit.x}
                    {@const labelY = exit.vertical ? exit.y : exit.y + (localY === 0 ? 35 : -25)}
                    <rect
                      x={exit.x - (exit.vertical ? 14 : 55)}
                      y={exit.y - (exit.vertical ? 55 : 14)}
                      width={exit.vertical ? 28 : 110}
                      height={exit.vertical ? 110 : 28}
                      fill="#5eead4"
                      opacity=".25"
                    />
                    <text
                      x={labelX}
                      y={labelY}
                      transform={exit.vertical
                        ? `rotate(${localX === 0 ? -90 : 90} ${labelX} ${labelY})`
                        : undefined}
                      text-anchor="middle"
                      dominant-baseline={exit.vertical ? 'middle' : undefined}
                      fill="#9de7d7"
                      font-size="14">{label}</text
                    >
                  {/each}
                  <text class="room-label" x={currentPage.x + 170} y={currentPage.y + 45}
                    >{currentPage.name.toUpperCase()}</text
                  >
                  {#if currentPage.id === 'centre'}
                    <DestinationMarker
                      kind="ci"
                      x={CI_CONSOLE.x}
                      baseY={CI_CONSOLE.y + 53}
                      iconY={CI_CONSOLE.y + 51}
                      baseWidth={240}
                      active={session.incident}
                      urgent={session.incident}
                      muted={!session.incident}
                      showIcon={!atConsole}
                    />
                    <g transform={`translate(${CI_CONSOLE.x},${CI_CONSOLE.y})`}>
                      <rect
                        x={-CI_CONSOLE.width / 2}
                        y="-36"
                        width={CI_CONSOLE.width}
                        height="68"
                        rx="5"
                        fill="#394351"
                        stroke={atConsole ? '#c3b6ff' : '#83909e'}
                        stroke-width="3"
                      />
                      <rect x="-92" y="-28" width="184" height="52" rx="3" fill="#17212b" />
                      <text y="-12" text-anchor="middle" fill="#e7eeff" font-size="12"
                        >CI CONTROL CONSOLE</text
                      >
                      <path
                        d={session.incident
                          ? 'M-55 4H-12M12 4H55M-5 -1L5 9M5 -1L-5 9'
                          : 'M-55 4H55'}
                        fill="none"
                        stroke={session.incident ? '#fda4af' : '#5eead4'}
                        stroke-width="3"
                      />
                      <circle
                        cx="-55"
                        cy="4"
                        r="4"
                        fill={session.incident ? '#fda4af' : '#5eead4'}
                      />
                      <circle
                        cx="55"
                        cy="4"
                        r="4"
                        fill={session.incident ? '#fda4af' : '#5eead4'}
                      />
                      <text
                        y="20"
                        text-anchor="middle"
                        fill={session.incident ? '#fda4af' : '#5eead4'}
                        font-size="11"
                        >{session.incident ? 'CI DOWN — REPAIR REQUIRED' : 'CI operational'}</text
                      >
                      {#if atConsole && !report && !trainingTarget}
                        <rect
                          x="-105"
                          y="76"
                          width="210"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke={session.incident
                            ? me?.active
                              ? '#c3b6ff'
                              : '#83909e'
                            : session.role === 'tester' && me?.active && !sabotageCooldown
                              ? '#fda4af'
                              : '#5eead4'}
                        />
                        <text y="94" text-anchor="middle" fill="#ffffff" font-size="14"
                          >{session.incident
                            ? me?.active
                              ? 'E • Repair CI'
                              : 'Active colleague required'
                            : session.role === 'tester' && me?.active
                              ? sabotageCooldown
                                ? `Break CI ready in ${sabotageCooldown}s`
                                : 'E • Break CI'
                              : 'CI operational ✓'}</text
                        >
                      {/if}
                    </g>
                    {#if session.meetingsLeft}
                      <DestinationMarker
                        kind="standup"
                        x={500}
                        baseY={342}
                        iconY={252}
                        baseWidth={150}
                        active={!session.incident && !!me?.active}
                        muted={session.incident || !me?.active}
                        showIcon={!atTable}
                      />
                    {/if}
                    <rect
                      x="442"
                      y="270"
                      width="116"
                      height="80"
                      rx="30"
                      fill="#574d42"
                      stroke="#897460"
                      stroke-width="2"
                    /><text x="500" y="317" text-anchor="middle" fill="#e3d6c4" font-size="12"
                      >STANDUP</text
                    >
                    {#if atTable && me?.active && !report && !trainingTarget}
                      <rect
                        x="395"
                        y="364"
                        width="210"
                        height="27"
                        rx="5"
                        fill="#17212b"
                        stroke="#c3b6ff"
                      />
                      <text x="500" y="382" text-anchor="middle" fill="#ffffff" font-size="14"
                        >{!session.meetingsLeft
                          ? 'No standups remaining'
                          : session.incident
                            ? 'CI down — standup blocked'
                            : 'E • Call standup'}</text
                      >
                    {/if}
                  {/if}
                  {#each STATIONS.filter((item) => pageAt(item)?.id === currentPage.id) as item}<g
                      >{#if !session.completed.includes(item.id)}
                        <DestinationMarker
                          kind="workstation"
                          x={item.x}
                          baseY={item.y + 24}
                          iconY={item.y - 50}
                          baseWidth={136}
                          active={!session.incident}
                          muted={session.incident}
                          showIcon={nearby?.id !== item.id}
                        />
                      {/if}<rect
                        x={item.x - 55}
                        y={item.y - 25}
                        width="110"
                        height="55"
                        rx="10"
                        fill={session.completed.includes(item.id) ? '#25463e' : '#4a5262'}
                        stroke={nearby?.id === item.id && !report && !trainingTarget
                          ? '#c3b6ff'
                          : '#637082'}
                        stroke-width="2"
                      /><text
                        x={item.x}
                        y={item.y + 12}
                        text-anchor="middle"
                        font-size="31"
                        fill="#d6dce8"
                        >{session.completed.includes(item.id) ? '✓' : item.symbol}</text
                      ><text
                        x={item.x}
                        y={item.y + 53}
                        text-anchor="middle"
                        fill="#b9c2d1"
                        font-size="12">{item.name}</text
                      >{#if nearby?.id === item.id && !report && !trainingTarget}<rect
                          x={item.x - 95}
                          y={item.y + 68}
                          width="190"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke="#c3b6ff"
                        /><text
                          x={item.x}
                          y={item.y + 86}
                          text-anchor="middle"
                          fill="#ffffff"
                          font-size="14"
                          >{session.completed.includes(item.id)
                            ? 'Ticket already closed ✓'
                            : session.incident
                              ? 'CI down — ticket blocked'
                              : 'E • Open ticket'}</text
                        >{/if}</g
                    >{/each}
                  {#each (session.accessPanels ?? []).filter((a) => pageAt(a)?.id === currentPage.id) as panel (panel.id)}
                    <g
                      class="access-panel"
                      data-panel-id={panel.id}
                      data-door={panel.open === true ? 'open' : 'closed'}
                      transform={`translate(${panel.x},${panel.y})`}
                    >
                      <title>Maintenance access panel</title>
                      <rect
                        x="-32"
                        y="-45"
                        width="64"
                        height="42"
                        rx="3"
                        fill="#101821"
                        stroke="#c6a96c"
                        stroke-width="2"
                      />
                      {#if panel.open === true}
                        <path d="M-32 -45L-46 -58H18L32 -45Z" fill="#63727e" stroke="#c6a96c" />
                        <path
                          d="M-19 -38V-10M19 -38V-10M-19 -30H19M-19 -18H19"
                          stroke="#657483"
                          stroke-width="3"
                        />
                      {:else}
                        <rect x="-28" y="-41" width="56" height="34" rx="2" fill="#465764" />
                        <path
                          d="M-20 -32H20M-20 -24H20M-20 -16H20"
                          stroke="#aeb9c0"
                          stroke-width="2"
                        />
                      {/if}
                      <text x="0" y="-66" text-anchor="middle" fill="#dac28c" font-size="11"
                        >MAINTENANCE</text
                      >
                      {#if nearbyAccess?.id === panel.id}
                        <rect
                          x="-98"
                          y="30"
                          width="196"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke="#c6a96c"
                        />
                        <text x="0" y="48" text-anchor="middle" fill="white" font-size="13"
                          >E • Use access panel</text
                        >
                      {/if}
                    </g>
                  {/each}
                  {#each (session.cupboards ?? []).filter((c) => pageAt(c)?.id === currentPage.id) as cupboard (cupboard.id)}
                    <g
                      class="supply-cupboard"
                      data-cupboard-id={cupboard.id}
                      data-door={cupboard.open === null
                        ? 'unknown'
                        : cupboard.open
                          ? 'open'
                          : 'closed'}
                      transform={`translate(${cupboard.x},${cupboard.y})`}
                    >
                      <title>Supply cupboard</title>
                      <rect
                        x="-31"
                        y="-68"
                        width="62"
                        height="64"
                        rx="4"
                        fill="#171e28"
                        stroke="#9ba6b5"
                        stroke-width="2"
                      />
                      {#if cupboard.open === true}
                        <path d="M-27 -45H27M-27 -25H27" stroke="#7c899a" stroke-width="3" />
                        <rect x="-21" y="-40" width="18" height="12" fill="#bba278" />
                        <path
                          d="M-31 -68L-46 -58V6L-31 -4ZM31 -68L46 -58V6L31 -4Z"
                          fill="#627181"
                          stroke="#9ba6b5"
                        />
                      {:else}
                        <rect x="-28" y="-65" width="56" height="58" fill="#627181" />
                        <path
                          d="M0 -65V-7M-6 -39V-29M6 -39V-29"
                          stroke="#d1d9e2"
                          stroke-width="2"
                        />
                      {/if}
                      <text x="0" y="-76" text-anchor="middle" fill="#c6ced9" font-size="11"
                        >SUPPLIES</text
                      >
                      {#if nearbyCupboard?.id === cupboard.id}
                        <rect
                          x="-104"
                          y="30"
                          width="208"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke="#c3b6ff"
                        />
                        <text x="0" y="48" text-anchor="middle" fill="white" font-size="13"
                          >{cupboardPrompt}</text
                        >
                      {/if}
                    </g>
                  {/each}
                  {#if limitedVision}
                    <rect
                      class="visibility-shade"
                      x={currentPage.x}
                      y={currentPage.y}
                      width="1000"
                      height="620"
                      fill="#080c14"
                      opacity="0.62"
                      mask="url(#visibility-mask)"
                      pointer-events="none"
                      aria-hidden="true"
                    />
                  {/if}
                  <!-- Navigation geometry stays readable even beyond the light. -->
                  {#each WALLS as wall}<rect
                      x={wall.x}
                      y={wall.y}
                      width={wall.w}
                      height={wall.h}
                      fill="#535c69"
                      rx="3"
                    />{/each}
                  {#each session.players.filter((p) => p.visible && !(p.id === session?.self && (hidden || travelling)) && pageAt(renderedPositions[p.id] ?? p)?.id === currentPage.id && (p.active || !p.reported || p.id === session?.self)) as person (person.id)}
                    {@const position = renderedPositions[person.id] ?? person}
                    <g
                      class="map-player"
                      data-player-id={person.id}
                      transition:fade={{ duration: 250 }}
                      style:opacity={!person.connected ? 0.35 : person.active ? 1 : 0.5}
                      transform={`translate(${position.x},${position.y})`}
                      >{#if limitedVision && person.active}
                        <!-- Shares the avatar's visibility and existing 250ms fade. -->
                        <g
                          transform={`translate(${-position.x},${-position.y})`}
                          clip-path="url(#visibility-area)"
                        >
                          <circle
                            class="player-glow"
                            cx={position.x}
                            cy={position.y}
                            r={person.id === session.self ? 64 : 42}
                            fill="url(#player-glow)"
                            opacity={person.id === session.self ? 1 : 0.65}
                            clip-path="url(#visibility-radius)"
                            pointer-events="none"
                            aria-hidden="true"
                          />
                        </g>
                      {/if}<ellipse cy="20" rx="19" ry="7" fill="#0006" /><rect
                        x="-15"
                        y="-20"
                        width="30"
                        height="38"
                        rx="12"
                        fill={person.color}
                      /><rect
                        x="-8"
                        y="-12"
                        width="21"
                        height="12"
                        rx="5"
                        fill="#253245"
                        stroke="#e7eeff"
                        stroke-width="2"
                      />{#if !person.active}<text
                          x="0"
                          y="10"
                          text-anchor="middle"
                          fill="#202631"
                          font-size="18">×</text
                        >{/if}{#if person.id === session.self}<path
                          d="M-5 -39L0 -32L5 -39"
                          fill="#fff"
                        />{/if}<text
                        y="-25"
                        text-anchor="middle"
                        font-size="12"
                        fill="#fff"
                        stroke="#202631"
                        stroke-width="3"
                        paint-order="stroke"
                        >{person.name}{person.id === session.self ? ' (you)' : ''}</text
                      >{#if report?.id === person.id}<rect
                          x="-105"
                          y={position.y - currentPage.y > 555 ? -74 : 34}
                          width="210"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke="#c3b6ff"
                        /><text
                          y={position.y - currentPage.y > 555 ? -56 : 52}
                          text-anchor="middle"
                          fill="#ffffff"
                          font-size="14">E • Report training notice</text
                        >{:else if trainingTarget?.id === person.id}<rect
                          x="-105"
                          y={position.y - currentPage.y > 555 ? -74 : 34}
                          width="210"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke="#fda4af"
                        /><text
                          y={position.y - currentPage.y > 555 ? -56 : 52}
                          text-anchor="middle"
                          fill="#ffffff"
                          font-size="14">T • Send Dev on training</text
                        >{:else if trainingCooldownTarget?.id === person.id}<rect
                          x="-105"
                          y={position.y - currentPage.y > 555 ? -74 : 34}
                          width="210"
                          height="27"
                          rx="5"
                          fill="#17212b"
                          stroke="#83909e"
                        /><text
                          y={position.y - currentPage.y > 555 ? -56 : 52}
                          text-anchor="middle"
                          fill="#ffffff"
                          font-size="14">Training ready in {cooldown}s</text
                        >{/if}</g
                    >{/each}
                </g>
              </svg>
              {#if limitedVision}
                <div class="visibility-hint">
                  {accessUse
                    ? accessLabel
                    : hidden
                      ? 'Hidden in cupboard · Half visibility · E to leave'
                      : 'Your light shows nearby colleagues. Walls and tall furniture block light and sight.'}
                </div>
              {/if}
              <div class="map-footer">
                <span aria-live="polite"
                  >{currentPage.name} · {currentPage.id === 'centre'
                    ? 'Central hub'
                    : `${currentPage.id} wing`}</span
                >
                <span
                  ><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows to move &nbsp;
                  <kbd>E</kbd> to interact</span
                ><span>OFFICE · FLOOR 01</span>
              </div>
            </section>
            <aside class="panel task-panel">
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable tickets need keyboard access.) -->
              <div class="task-details" role="region" aria-label="Sprint tickets" tabindex="0">
                <div class="eyebrow">
                  {session.role === 'tester' ? 'YOUR SECRET AGENDA' : 'YOUR SPRINT BACKLOG'}
                </div>
                <h2>
                  {session.role === 'tester' ? 'Delay. Deflect. Repeat.' : 'Let’s ship something.'}
                </h2>
                <p>
                  {session.role === 'tester'
                    ? 'Blend in at workstations. Your tickets do not advance the release.'
                    : !me?.active
                      ? 'Training isn’t a holiday. Finish your tickets, but keep quiet on Teams.'
                      : 'Visit each workstation and close your tickets.'}
                </p>
                <div class="task-list">
                  {#each STATIONS as item}<div class:done={session.completed.includes(item.id)}>
                      <span>{session.completed.includes(item.id) ? '✓' : '○'}</span>
                      <div><strong>{item.name}</strong><small>{item.room}</small></div>
                    </div>{/each}
                </div>
                <small class="muted"
                  >Standups happen at the centre table.<br />Your camera is your poker face.</small
                >
              </div>
              <div class="context-actions">
                {#if nearbyAccess || accessUse}
                  <button class="secondary wide" disabled={!!accessUse} onclick={useAccess}
                    >{accessLabel}</button
                  >
                  <small role="status"
                    >{travelling
                      ? 'In transit. You cannot see colleagues or take actions.'
                      : 'Connects to the opposite wing. Entry and exit are visible.'}</small
                  >
                {/if}
                {#if nearbyCupboard || cupboardUse}
                  <button
                    class="secondary wide"
                    disabled={!!cupboardUse && !hidden}
                    onclick={useCupboard}>{cupboardLabel}</button
                  >
                  {#if cupboardUse}<small role="status"
                      >{hidden
                        ? 'You are hidden. Visibility is halved. Leave to move or act.'
                        : 'Colleagues can see you during entry and exit.'}</small
                    >{/if}
                {/if}
                {#if report && me?.active}<button
                    class="secondary wide"
                    onclick={() => act({ type: 'report' })}>Report training notice • E</button
                  >{:else if atConsole && session.incident}<button
                    class="primary wide"
                    disabled={!me?.active}
                    onclick={openRepair}
                    >{me?.active ? 'Repair CI • E' : 'Active colleague required'}</button
                  >{/if}{#if nearby && !report}<button
                    class="primary wide"
                    disabled={session.completed.includes(nearby.id) || session.incident}
                    onclick={openTask}
                    >{session.completed.includes(nearby.id)
                      ? 'Ticket already closed ✓'
                      : 'Open ticket • E'}</button
                  >{/if}{#if atTable && me?.active && !report}<button
                    class="secondary wide"
                    disabled={!session.meetingsLeft || session.incident}
                    onclick={() => act({ type: 'meeting' })}
                    >Call standup ({session.meetingsLeft} left) • E</button
                  >{/if}{#if session.role === 'tester' && me?.active}<button
                    class="sabotage wide"
                    disabled={interactionLocked || session.incident || sabotageCooldown > 0}
                    onclick={() => act({ type: 'sabotage' })}
                    >{sabotageCooldown
                      ? `Break CI ready in ${sabotageCooldown}s`
                      : 'Break CI • B'}</button
                  >{#if session.players.length > 3}<button
                      class="sabotage wide"
                      disabled={!target || cooldown > 0}
                      onclick={() => target && act({ type: 'sideline', target: target.id })}
                      >{cooldown
                        ? `Training ready in ${cooldown}s`
                        : target
                          ? `Send ${target.name} on training • T`
                          : 'Move near a dev to send on training'}</button
                    >{:else}<small>Three-person sprint: win by running out the clock.</small
                    >{/if}{/if}
              </div>
            </aside>
          </div>
        {/if}
      {/if}
      {#if !inRound}<button class="quiet leave" onclick={leave}>← Leave workspace</button>{/if}
    </main>
  {/if}
  {#if error}<div class:in-game={session?.phase === 'work'} class="toast error" role="alert">
      {error}<button aria-label="Dismiss error" onclick={() => (error = '')}>×</button>
    </div>{/if}
  {#if notice && !error}
    {#key notice.id}
      <div
        class:in-game={session?.phase === 'work'}
        class:paused={noticePaused}
        class="toast"
        role="status"
        style:--toast-duration={`${notice.duration}ms`}
        onpointerenter={() => pauseNotice('pointer')}
        onpointerleave={() => resumeNotice('pointer')}
        onfocusin={() => pauseNotice('focus')}
        onfocusout={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            resumeNotice('focus');
        }}
      >
        {notice.message}<button aria-label="Dismiss notification" onclick={() => dismissNotice()}
          >×</button
        >
        <span class="toast-progress" aria-hidden="true"></span>
      </div>
    {/key}
  {/if}
  <footer>
    <span>BUILT FOR TEAMS. QUESTIONABLE FOR PRODUCTIVITY.</span><span
      >Less status update. More plot twist. <span class="footer-star">✳</span></span
    >
  </footer>
</div>

{#if session?.phase === 'role-reveal' && session.role}
  <div class="role-reveal-backdrop">
    <div
      class:tester={session.role === 'tester'}
      class:dev={session.role === 'dev'}
      class="role-reveal-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-reveal-title"
      aria-describedby="role-reveal-message role-reveal-countdown"
    >
      <div class="role-reveal-icon" aria-hidden="true">
        {session.role === 'tester' ? 'QA' : 'DEV'}
      </div>
      <div class="eyebrow">YOUR SPRINT ROLE</div>
      <h2 id="role-reveal-title">
        You are {session.role === 'tester' ? 'the Tester' : 'a Developer'}
      </h2>
      <p id="role-reveal-message">
        {session.role === 'tester'
          ? 'Blend in, delay the release, and keep your role secret.'
          : 'Close every ticket and identify the tester before the deadline.'}
      </p>
      <div id="role-reveal-countdown" class="role-reveal-countdown" aria-live="polite">
        Sprint starts in {seconds}…
      </div>
    </div>
  </div>
{/if}

{#if session?.phase === 'meeting-result' && session.meetingResult}
  <div class="meeting-result-backdrop">
    <div
      class:success={session.meetingResult.testerIdentified}
      class="meeting-result-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-result-title"
      aria-describedby="meeting-result-message meeting-result-countdown"
    >
      <div class="meeting-result-icon" aria-hidden="true">
        {session.meetingResult.testerIdentified ? '✓' : '×'}
      </div>
      <div class="eyebrow">STANDUP RESULT</div>
      <h2 id="meeting-result-title">
        {session.meetingResult.testerIdentified ? 'Tester identified' : 'Tester not identified'}
      </h2>
      <p id="meeting-result-message">{session.meetingResult.message}</p>
      <div id="meeting-result-countdown" class="meeting-result-countdown" aria-live="polite">
        {session.meetingResult.continues ? 'Resuming' : 'Sprint ending'} in {seconds}…
      </div>
    </div>
  </div>
{/if}

{#if station && session?.phase === 'work'}
  <div class="modal-backdrop">
    <div
      use:focusDialog
      class="modal"
      class:incident-modal={repairing}
      class:workstation-modal={!repairing}
      role="dialog"
      aria-modal="true"
      aria-label={station.name}
      tabindex="-1"
    >
      <button class="close quiet" onclick={() => (stationId = '')} aria-label="Close ticket"
        >×</button
      >
      <div class="eyebrow">
        {station.room} · {repairing ? 'SHARED INCIDENT' : 'TICKET IN PROGRESS'}
      </div>
      <h2>{station.name}</h2>
      {#if currentPuzzle}
        <MiniTask
          puzzle={currentPuzzle}
          shared={repairing}
          disabled={taskPending || (session.incident && !repairing) || !connected}
          submit={submitTask}
        />
      {/if}
      {#if taskError}<p role="alert">{taskError}</p>{/if}
      {#if session.incident && !repairing}<p role="status">
          CI is down. Press Esc and go to the CI Control Console to repair it. Your accepted steps
          are saved.
        </p>{/if}
    </div>
  </div>
{/if}
{#if help}
  <div class="modal-backdrop">
    <div
      use:focusDialog
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="How it works"
      tabindex="-1"
    >
      <button class="close quiet" onclick={() => (help = false)} aria-label="Close instructions"
        >×</button
      >
      <div class="eyebrow">THE EMPLOYEE HANDBOOK</div>
      <h2>A sprint with a secret.</h2>
      <p>
        One colleague is secretly the tester. Devs win by completing every dev’s four tickets or
        voting the tester onto training. The tester wins when the four-minute work clock runs out,
        or only one active dev remains (4+ people).
      </p>
      <p>
        Move with <b>WASD or arrow keys</b>. Walk through the marked edge doorways to change
        screens. Four wings connect through the central office. Press <b>E</b> near a workstation to work
        on a ticket.
      </p>
      <p>
        The tester can press <b>B</b> anywhere to break CI every 45 seconds and press <b>T</b> to
        send a nearby colleague on training every 30 seconds. To repair CI, go to the CI Control
        Console at the top of the central office, press <b>E</b>, and complete the three shared
        stages on the shared incident board. Select a recovery action and its destination, or drag
        it onto the board: pause the pipeline, clear the bad deployment, then check health. Any
        active colleague, including the tester, can help; trainees cannot. Repairs do not close
        tickets. The tester can also press
        <b>E</b> at that console to break CI. The Server Cupboard’s restart task is a separate ticket.
        With three people, the tester’s training action is disabled.
      </p>
      <p>
        Call one standup per person at the central table, or report a nearby training notice.
        Discuss on Teams and vote here within 40 seconds. Ties and skips remove nobody. Work time
        pauses through voting and the three-second result countdown.
      </p>
      <p>
        Three supply cupboards spawn each sprint on three different pages, chosen from two fixed
        spots per page. Only the active Tester can press <b>E</b> nearby to hide or leave. Entering and
        exiting take one second, during which you are visible and cannot move. While hidden, your sight
        radius is halved and you must leave before taking other actions. Cupboards start shut, close while
        occupied, and stay open after exit. You can reuse them. Standups bring you out of hiding. There
        is no hiding time limit.
      </p>
      <p>
        If you are on training, finish your tickets, but don’t vote or reveal what you saw on Teams.
        Roles stay private until the retrospective.
      </p>
      <p>
        One pair of maintenance access panels connects either Development and Kitchen or Server
        Cupboard and Product Corner, chosen randomly each sprint. Each endpoint has two possible
        locations. Everyone can see the active panel from anywhere on its page. Only the active
        Tester can press <b>E</b> to travel. Entry, travel and exit each take one second. Entry and exit
        are visible; during travel you are hidden and cannot see colleagues. Movement and other actions
        are blocked throughout. Used panels remain open. A standup interrupts travel at the entrance unless
        you have already begun exiting.
      </p>
      <button class="primary" onclick={() => (help = false)}>Sounds suspicious. I’m in.</button>
    </div>
  </div>
{/if}
