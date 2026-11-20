/**
 * --progress-events: one `SOGNI_EVENT <json>` stderr line per lifecycle event
 * the Sogni SDK reports while a render waits or runs. Each line carries only
 * what the server sent; nothing here estimates a time or a percentage.
 */

export const SOGNI_EVENT_PREFIX = 'SOGNI_EVENT ';

// A countdown or step stream arrives about once a second. Each kind of line
// prints at most once per interval for a project; a phase change prints at once.
export const PROGRESS_EVENT_INTERVAL_MS = 5000;

// The phase each event announces. A time-left line belongs to no phase: the
// countdown runs through queueing, model loading and rendering alike.
const EVENT_PHASES = {
  queued: 'queued',
  'model-loading': 'model-loading',
  started: 'started',
  progress: 'running',
  retry: 'retry',
  eta: null
};

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Line writer with the per-project throttle. A line whose event starts a new
 * phase prints at once and drops every line still waiting. Otherwise each event
 * kind prints its first line, then at most one line per interval: the newest
 * one waiting when the interval has passed. A line identical to the last one
 * of its kind never prints. `close(projectId)` drops waiting lines once the
 * project has ended.
 */
export function createProgressEventWriter({
  write,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  intervalMs = PROGRESS_EVENT_INTERVAL_MS
}) {
  const projects = new Map();
  const projectState = (key) => {
    if (!projects.has(key)) projects.set(key, { phase: null, kinds: new Map() });
    return projects.get(key);
  };
  const kindState = (project, event) => {
    if (!project.kinds.has(event)) project.kinds.set(event, { lastLine: null, lastAt: -Infinity, pending: null, timer: null });
    return project.kinds.get(event);
  };
  const print = (slot, line) => {
    slot.lastLine = line;
    slot.lastAt = now();
    write(`${SOGNI_EVENT_PREFIX}${line}\n`);
  };
  const cancel = (slot) => {
    if (slot.timer) clearTimer(slot.timer);
    slot.timer = null;
    slot.pending = null;
  };

  return {
    emit(event, projectId, fields = {}) {
      if (!Object.hasOwn(EVENT_PHASES, event)) return;
      const payload = { event, ...(projectId ? { projectId } : {}) };
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) payload[key] = value;
      }
      const line = JSON.stringify(payload);
      const project = projectState(projectId || '');
      const slot = kindState(project, event);
      const phase = EVENT_PHASES[event];
      if (phase && phase !== project.phase) {
        for (const other of project.kinds.values()) cancel(other);
        project.phase = phase;
        print(slot, line);
        return;
      }
      if (line === slot.lastLine) {
        cancel(slot);
        return;
      }
      const waitMs = slot.lastAt + intervalMs - now();
      if (waitMs <= 0) {
        cancel(slot);
        print(slot, line);
        return;
      }
      slot.pending = line;
      if (slot.timer) return;
      slot.timer = setTimer(() => {
        slot.timer = null;
        const pending = slot.pending;
        slot.pending = null;
        if (pending && pending !== slot.lastLine) print(slot, pending);
      }, waitMs);
      slot.timer?.unref?.();
    },
    close(projectId) {
      const project = projects.get(projectId || '');
      if (!project) return;
      for (const slot of project.kinds.values()) cancel(slot);
    }
  };
}

/**
 * Follow one SDK client's project, job and retry events for the projects
 * `allow(projectId)` accepts, writing them through `writer`. The percentage is
 * the SDK's own figure for the whole project. Returns a function that stops
 * following.
 */
export function attachProgressEvents(sdk, { allow, writer }) {
  const projectsApi = sdk?.projects;
  const socket = sdk?.apiClient?.socket;
  if (typeof projectsApi?.on !== 'function') return () => {};

  const projectPercent = (projectId) => {
    const tracked = Array.isArray(projectsApi.trackedProjects)
      ? projectsApi.trackedProjects.find((project) => project?.id === projectId)
      : null;
    return finiteNumber(tracked?.progress);
  };

  const onProject = (event) => {
    if (!event?.projectId || !allow(event.projectId)) return;
    if (event.type === 'queued') {
      writer.emit('queued', event.projectId, {
        queuePosition: finiteNumber(event.queuePosition),
        startsInSeconds: finiteNumber(event.estimatedStartSeconds)
      });
    } else if (event.type === 'completed' || event.type === 'error') {
      writer.close(event.projectId);
    }
  };

  const onJob = (event) => {
    if (!event?.projectId || !allow(event.projectId)) return;
    switch (event.type) {
      case 'initiating':
        writer.emit('model-loading', event.projectId);
        break;
      case 'started':
        writer.emit('started', event.projectId);
        break;
      case 'progress': {
        const etaSeconds = finiteNumber(event.etaSeconds);
        writer.emit('progress', event.projectId, {
          percent: projectPercent(event.projectId),
          step: finiteNumber(event.step),
          stepCount: finiteNumber(event.stepCount),
          // The worker sends 0 when it has no estimate for this step.
          etaSeconds: etaSeconds > 0 ? etaSeconds : undefined
        });
        break;
      }
      case 'jobETA': {
        const etaSeconds = finiteNumber(event.etaSeconds);
        if (etaSeconds !== undefined) writer.emit('eta', event.projectId, { etaSeconds });
        break;
      }
      default:
        break;
    }
  };

  // The SDK handles a reassigned render internally and emits no job event for
  // it, so the retry notice is read from the socket frame itself.
  const onRetry = (data) => {
    if (!data?.jobID || !allow(data.jobID)) return;
    writer.emit('retry', data.jobID, {
      attempt: finiteNumber(data.attempt),
      maxAttempts: finiteNumber(data.maxAttempts)
    });
  };

  projectsApi.on('project', onProject);
  projectsApi.on('job', onJob);
  if (typeof socket?.on === 'function') socket.on('jobRetry', onRetry);
  return () => {
    projectsApi.off?.('project', onProject);
    projectsApi.off?.('job', onJob);
    socket?.off?.('jobRetry', onRetry);
  };
}
