<script lang="ts">
  import { onMount } from 'svelte';
  import MiniTask from '$lib/MiniTask.svelte';
  import { fade } from 'svelte/transition';
  import { io, type Socket } from 'socket.io-client';
  import { PositionInterpolator, type InterpolatedPosition } from '$lib/interpolation';
  import {
    CI_CONSOLE,
    STATIONS,
    WALLS,
    PAGES,
    EXITS,
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
  let currentPage = $derived((me && pageAt(renderedPositions[me.id] ?? me)) || PAGES[0]);
  let repairing = $derived(stationId === 'ci');
  let station = $derived(
    repairing
      ? { id: 'ci', name: 'Repair CI', room: 'CI Control Console' }
      : STATIONS.find((s) => s.id === stationId)
  );
  let currentPuzzle = $derived(repairing ? session?.repair : session?.puzzles[stationId]);
  let nearby = $derived(
    me
      ? STATIONS.find(
          (s) => pageAt(s)?.id === pageAt(me)?.id && Math.hypot(s.x - me.x, s.y - me.y) <= 80
        )
      : undefined
  );
  let atTable = $derived(me ? Math.hypot(me.x - 500, me.y - 310) <= 80 : false);
  let atConsole = $derived(me ? atCiConsole(me) : false);
  let target = $derived(
    me && session
      ? nearestWithin(
          me,
          session.players.filter((p) => p.visible && p.active && p.id !== me.id),
          65
        )
      : undefined
  );
  let report = $derived(
    session?.phase === 'work' && me?.active
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
  function submitTask(answer: string) {
    const puzzle = currentPuzzle;
    if (!puzzle || taskPending || !connected) return;
    taskPending = true;
    taskError = '';
    const submittedStation = stationId;
    metric(submittedStation).attempts++;
    socket.timeout(5000).emit(
      'action',
      (repairing
        ? { type: 'repair', puzzle: puzzle.id, step: puzzle.step, answer }
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
        if (reply?.error?.includes('refinement') || reply?.error?.includes('setting will not'))
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
        if (session?.phase !== 'work') movement.reset();
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
        if (report && me?.active) {
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
      if (!connected || session?.phase !== 'work' || stationId || help) return;
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

<div class="app-shell">
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
        <div class="code-box">
          <small>WORKSPACE CODE</small><button onclick={copy}
            >{session.code} <span>{copied ? '✓' : '⧉'}</span></button
          >
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
                >Go to the CI Control Console at the top of the central office and press E to repair
                CI. An active colleague must restore CI before tickets can continue.</span
              >
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
                  ></defs
                >
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
                {#each WALLS as wall}<rect
                    x={wall.x}
                    y={wall.y}
                    width={wall.w}
                    height={wall.h}
                    fill="#535c69"
                    rx="3"
                  />{/each}
                <text class="room-label" x={currentPage.x + 170} y={currentPage.y + 45}
                  >{currentPage.name.toUpperCase()}</text
                >
                {#if currentPage.id === 'centre'}
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
                      d={session.incident ? 'M-55 4H-12M12 4H55M-5 -1L5 9M5 -1L-5 9' : 'M-55 4H55'}
                      fill="none"
                      stroke={session.incident ? '#fda4af' : '#5eead4'}
                      stroke-width="3"
                    />
                    <circle cx="-55" cy="4" r="4" fill={session.incident ? '#fda4af' : '#5eead4'} />
                    <circle cx="55" cy="4" r="4" fill={session.incident ? '#fda4af' : '#5eead4'} />
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
                            ? 'E — Repair CI'
                            : 'Active colleague required'
                          : session.role === 'tester' && me?.active
                            ? sabotageCooldown
                              ? `Break CI ready in ${sabotageCooldown}s`
                              : 'E — Break CI'
                            : 'CI operational ✓'}</text
                      >
                    {/if}
                  </g>
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
                          : 'E — Call standup'}</text
                    >
                  {/if}
                {/if}
                {#each STATIONS.filter((item) => pageAt(item)?.id === currentPage.id) as item}<g
                    ><rect
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
                      fill="#d6dce8">{session.completed.includes(item.id) ? '✓' : item.symbol}</text
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
                            : 'E — Open ticket'}</text
                      >{/if}</g
                  >{/each}
                {#each session.players.filter((p) => p.visible && pageAt(renderedPositions[p.id] ?? p)?.id === currentPage.id && (p.active || !p.reported || p.id === session?.self)) as person (person.id)}
                  {@const position = renderedPositions[person.id] ?? person}
                  <g
                    transition:fade={{ duration: 250 }}
                    style:opacity={!person.connected ? 0.35 : person.active ? 1 : 0.5}
                    transform={`translate(${position.x},${position.y})`}
                    ><ellipse cy="20" rx="19" ry="7" fill="#0006" /><rect
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
                        font-size="14">E — Report training notice</text
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
                        font-size="14">T — Send Dev on training</text
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
              </svg>
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
              <div class="context-actions">
                {#if report && me?.active}<button
                    class="secondary wide"
                    onclick={() => act({ type: 'report' })}>Report training notice · E</button
                  >{:else if atConsole && session.incident}<button
                    class="primary wide"
                    disabled={!me?.active}
                    onclick={openRepair}
                    >{me?.active ? 'Repair CI · E' : 'Active colleague required'}</button
                  >{/if}{#if nearby && !report}<button
                    class="primary wide"
                    disabled={session.completed.includes(nearby.id) || session.incident}
                    onclick={openTask}
                    >{session.completed.includes(nearby.id)
                      ? 'Ticket already closed ✓'
                      : 'Open ticket · E'}</button
                  >{/if}{#if atTable && me?.active && !report}<button
                    class="secondary wide"
                    disabled={!session.meetingsLeft || session.incident}
                    onclick={() => act({ type: 'meeting' })}
                    >Call standup ({session.meetingsLeft} left) · E</button
                  >{/if}{#if session.role === 'tester' && me?.active}<button
                    class="sabotage wide"
                    disabled={session.incident || sabotageCooldown > 0}
                    onclick={() => act({ type: 'sabotage' })}
                    >{sabotageCooldown
                      ? `Break CI ready in ${sabotageCooldown}s`
                      : 'Break CI · B'}</button
                  >{#if session.players.length > 3}<button
                      class="sabotage wide"
                      disabled={!target || cooldown > 0}
                      onclick={() => target && act({ type: 'sideline', target: target.id })}
                      >{cooldown
                        ? `Training ready in ${cooldown}s`
                        : target
                          ? `Send ${target.name} on training · T`
                          : 'Move near a dev to send on training'}</button
                    >{:else}<small>Three-person sprint: win by running out the clock.</small
                    >{/if}{/if}
              </div>
              <small class="muted"
                >Standups happen at the centre table.<br />Your camera is your poker face.</small
              >
            </aside>
          </div>
        {/if}
      {/if}
      <button class="quiet leave" onclick={leave}>← Leave workspace</button>
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
        repair steps. Any active colleague, including the tester, can help; trainees cannot. Repairs
        do not close tickets. The tester can also press
        <b>E</b> at that console to break CI. The Server Cupboard’s restart task is a separate ticket.
        With three people, the tester’s training action is disabled.
      </p>
      <p>
        Call one standup per person at the central table, or report a nearby training notice.
        Discuss on Teams and vote here within 40 seconds. Ties and skips remove nobody. Work time
        pauses through voting and the three-second result countdown.
      </p>
      <p>
        If you are on training, finish your tickets, but don’t vote or reveal what you saw on Teams.
        Roles stay private until the retrospective.
      </p>
      <button class="primary" onclick={() => (help = false)}>Sounds suspicious. I’m in.</button>
    </div>
  </div>
{/if}
