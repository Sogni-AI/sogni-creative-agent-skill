import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  PROGRESS_EVENT_INTERVAL_MS, SOGNI_EVENT_PREFIX, attachProgressEvents, createProgressEventWriter
} from '../progress-events.mjs';

// A writer on a hand-driven clock: `advance(ms)` moves time and fires due timers.
function manualWriter() {
  const lines = [];
  let clock = 0;
  const timers = [];
  const writer = createProgressEventWriter({
    write: (text) => lines.push(JSON.parse(text.slice(SOGNI_EVENT_PREFIX.length))),
    now: () => clock,
    setTimer: (fn, ms) => {
      const timer = { at: clock + ms, fn, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; }
  });
  const advance = (ms) => {
    clock += ms;
    for (const timer of timers.filter((entry) => !entry.cleared && entry.at <= clock)) {
      timer.cleared = true;
      timer.fn();
    }
  };
  return { writer, lines, advance };
}

test('a 1 Hz countdown prints about one line per interval, and the newest one', () => {
  const { writer, lines, advance } = manualWriter();
  for (let second = 0; second < 12; second++) {
    writer.emit('eta', 'p1', { etaSeconds: 60 - second });
    advance(1000);
  }
  // Printed at 0 s, 5 s and 10 s: each time the newest value waiting then.
  assert.equal(PROGRESS_EVENT_INTERVAL_MS, 5000);
  assert.deepEqual(lines.map((line) => line.etaSeconds), [60, 56, 51]);
});

test('a phase change prints at once and drops the lines still waiting', () => {
  const { writer, lines, advance } = manualWriter();
  writer.emit('queued', 'p1', { queuePosition: 3, startsInSeconds: 45 });
  writer.emit('queued', 'p1', { queuePosition: 2 });
  writer.emit('started', 'p1');
  writer.emit('progress', 'p1', { percent: 10, step: 3, stepCount: 30 });
  writer.emit('progress', 'p1', { percent: 13, step: 4, stepCount: 30 });
  writer.emit('retry', 'p1', { attempt: 2, maxAttempts: 3 });
  advance(10000);
  assert.deepEqual(lines, [
    { event: 'queued', projectId: 'p1', queuePosition: 3, startsInSeconds: 45 },
    { event: 'started', projectId: 'p1' },
    { event: 'progress', projectId: 'p1', percent: 10, step: 3, stepCount: 30 },
    { event: 'retry', projectId: 'p1', attempt: 2, maxAttempts: 3 }
  ]);
});

test('a time-left countdown changes no phase, so step progress and the countdown each keep printing', () => {
  // The order a FastH3 render reported on 2026-11-20: two model-loading frames
  // around the countdown, then steps every few seconds under a 1 Hz countdown.
  const { writer, lines, advance } = manualWriter();
  writer.emit('model-loading', 'p1');
  writer.emit('eta', 'p1', { etaSeconds: 29 });
  advance(1000);
  writer.emit('model-loading', 'p1');
  writer.emit('eta', 'p1', { etaSeconds: 42 });
  writer.emit('started', 'p1');
  for (let second = 0; second < 12; second++) {
    advance(1000);
    writer.emit('eta', 'p1', { etaSeconds: 41 - second });
    if (second % 3 === 0) writer.emit('progress', 'p1', { percent: second * 8, step: second / 3, stepCount: 4 });
  }
  // The repeated model-loading frame is dropped, the countdown prints once per
  // interval beside the steps, and a step that waited gives way to a newer one.
  assert.deepEqual(lines.map((line) => line.event), [
    'model-loading', 'eta', 'started', 'progress', 'eta', 'progress', 'eta', 'progress'
  ]);
  assert.deepEqual(lines.filter((line) => line.event === 'progress').map((line) => line.step), [0, 1, 3]);
});

test('identical repeats never print, projects throttle separately, and close drops a waiting line', () => {
  const { writer, lines, advance } = manualWriter();
  writer.emit('queued', 'p1', { queuePosition: 1 });
  writer.emit('queued', 'p2', { queuePosition: 4 });
  advance(6000);
  writer.emit('queued', 'p1', { queuePosition: 1 });
  writer.emit('eta', 'p2', { etaSeconds: 30 });
  writer.emit('eta', 'p2', { etaSeconds: 29 });
  writer.close('p2');
  advance(6000);
  assert.deepEqual(lines, [
    { event: 'queued', projectId: 'p1', queuePosition: 1 },
    { event: 'queued', projectId: 'p2', queuePosition: 4 },
    { event: 'eta', projectId: 'p2', etaSeconds: 30 }
  ]);
});

test('SDK events map to lines with only the fields the server sent', () => {
  const { writer, lines } = manualWriter();
  const projects = new EventEmitter();
  const socket = new EventEmitter();
  Object.defineProperty(projects, 'trackedProjects', { get: () => [{ id: 'mine', progress: 40 }] });
  const stop = attachProgressEvents({ projects, apiClient: { socket } }, {
    allow: (projectId) => projectId === 'mine',
    writer
  });
  projects.emit('project', { type: 'queued', projectId: 'mine', queuePosition: 2, estimatedStartSeconds: null });
  projects.emit('project', { type: 'queued', projectId: 'other', queuePosition: 9 });
  projects.emit('job', { type: 'initiating', projectId: 'mine', jobId: 'j1' });
  projects.emit('job', { type: 'started', projectId: 'mine', jobId: 'j1' });
  projects.emit('job', { type: 'progress', projectId: 'mine', jobId: 'j1', step: 12, stepCount: 30, etaSeconds: 0 });
  socket.emit('jobRetry', { jobID: 'mine', imgID: 'j1', attempt: 2, maxAttempts: 3 });
  projects.emit('job', { type: 'jobETA', projectId: 'mine', jobId: 'j2', etaSeconds: 95 });
  stop();
  projects.emit('job', { type: 'started', projectId: 'mine', jobId: 'j3' });
  assert.deepEqual(lines, [
    { event: 'queued', projectId: 'mine', queuePosition: 2 },
    { event: 'model-loading', projectId: 'mine' },
    { event: 'started', projectId: 'mine' },
    { event: 'progress', projectId: 'mine', percent: 40, step: 12, stepCount: 30 },
    { event: 'retry', projectId: 'mine', attempt: 2, maxAttempts: 3 },
    { event: 'eta', projectId: 'mine', etaSeconds: 95 }
  ]);
});
