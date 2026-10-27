#!/usr/bin/env node
// test-opencode-session-bootstrap.mjs — ported from upstream superpowers v7.0.0
// tests/opencode/test-session-bootstrap.mjs (#2160 child-session skip, lookup
// recovery, bounded cache, V2 compaction checkpoints), run hermetically against
// a fixture copy of .opencode/plugins/beads-superpowers.js whose
// hooks/session-start is a stub composer (same pattern as
// test-opencode-injection.mjs). Fork additions at the end: V2 compaction
// re-composes the beads context once per session.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsp-oc-session-'));
process.on('exit', () => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
const pluginFile = path.join(fixtureRoot, '.opencode/plugins/beads-superpowers.js');
fs.mkdirSync(path.dirname(pluginFile), { recursive: true });
fs.copyFileSync(path.join(repoRoot, '.opencode/plugins/beads-superpowers.js'), pluginFile);
fs.symlinkSync(path.join(repoRoot, 'skills'), path.join(fixtureRoot, 'skills'));
fs.mkdirSync(path.join(fixtureRoot, 'hooks'));
const composerRuns = path.join(fixtureRoot, 'composer-runs');
// Stub composer: records each run (one byte per exec), then prints a payload.
fs.writeFileSync(path.join(fixtureRoot, 'hooks/session-start'),
  `#!/bin/sh\nprintf x >> "${composerRuns}"\nprintf '<EXTREMELY_IMPORTANT>\\nstub bootstrap\\n</EXTREMELY_IMPORTANT>\\n'\n`,
  { mode: 0o755 });
const runs = () => (fs.existsSync(composerRuns) ? fs.readFileSync(composerRuns, 'utf8').length : 0);

const pluginURL = pathToFileURL(fs.realpathSync(pluginFile));
const marker = '<EXTREMELY_IMPORTANT>\nstub bootstrap';
let generation = 0;

function reply(flavor, session) {
  return flavor === 'v1' ? { data: session } : session;
}

function makeEvent(flavor, sessionID) {
  const text = { type: 'text', text: 'Execute the assigned task' };
  return {
    sessionID,
    messages: [flavor === 'v1'
      ? { info: { role: 'user', sessionID }, parts: [text] }
      : { role: 'user', content: [text] }],
  };
}

function bootstrapCount(event) {
  return event.messages.flatMap((message) => message.parts ?? message.content ?? []).filter(
    (part) => part.type === 'text' && part.text.startsWith(marker)
  ).length;
}

async function makeHarness(flavor, fetchSession) {
  const mod = await import(`${pluginURL.href}?session-test=${++generation}`);
  const lookups = [];
  const registered = [];
  const get = async (id) => {
    lookups.push(id);
    return fetchSession(id, lookups.length);
  };
  let invoke;
  if (flavor === 'v1') {
    const hooks = await mod.BeadsSuperpowersPlugin({
      client: { session: { get: ({ path: { id } }) => get(id) } },
      directory: '.',
    });
    invoke = (event) => hooks['experimental.chat.messages.transform']({}, event);
  } else {
    await mod.default.setup({
      skill: { transform: async (transform) => transform({ add: (skill) => registered.push(skill) }) },
      session: {
        get: ({ sessionID }) => get(sessionID),
        hook: async (name, callback) => { if (name === 'context') invoke = callback; },
      },
    });
  }
  assert.equal(typeof invoke, 'function');
  return { invoke, lookups, registered };
}

for (const flavor of ['v1', 'v2']) {
  for (const [kind, extra, expected] of [
    ['root', {}, 1],
    ['child', { parentID: 'parent' }, 0],
    ['fork', { fork: { sessionID: 'origin' } }, 1],
  ]) {
    const id = `${flavor}-${kind}`;
    const h = await makeHarness(flavor, () => reply(flavor, { id, ...extra }));
    const event = makeEvent(flavor, id);
    await h.invoke(event);
    assert.equal(bootstrapCount(event), expected, `${id}: first request`);
    await h.invoke(event);
    assert.equal(bootstrapCount(event), expected, `${id}: repeated event`);
    const fresh = makeEvent(flavor, id);
    await h.invoke(fresh);
    assert.equal(bootstrapCount(fresh), expected, `${id}: fresh request`);
    assert.deepEqual(h.lookups, [id], `${id}: cache successful classification`);
    if (flavor === 'v2' && kind === 'child') {
      assert.ok(h.registered.some((skill) => skill.id === 'brainstorming'));
    }
  }

  const failures = [
    ['throws', () => { throw new Error('temporary lookup failure'); }],
    ['missing', () => undefined],
    ['null', () => null],
    ['empty', () => reply(flavor, {})],
    ['wrong-id', () => reply(flavor, { id: 'different-session' })],
    ['invalid-parent', (id) => reply(flavor, { id, parentID: 42 })],
  ];
  if (flavor === 'v1') {
    failures.push(['resolved-http-error', () => ({
      data: undefined,
      error: { name: 'UnknownError', data: { message: 'temporary 503' } },
      response: { ok: false, status: 503 },
    })]);
  }
  for (const [kind, firstResult] of failures) {
    const id = `${flavor}-${kind}`;
    const h = await makeHarness(flavor, (sessionID, call) => call === 1
      ? firstResult(sessionID)
      : reply(flavor, { id: sessionID, parentID: 'parent' }));
    const counts = [];
    for (let step = 0; step < 2; step++) {
      const event = makeEvent(flavor, id);
      await h.invoke(event);
      counts.push(bootstrapCount(event));
    }
    assert.deepEqual(counts, [1, 0], `${id}: recover on the next request`);
    assert.deepEqual(h.lookups, [id, id], `${id}: never cache the failure`);
  }

  const isolated = await makeHarness(flavor, (id) => reply(flavor,
    id === 'child-session' ? { id, parentID: 'parent' } : { id }));
  for (const [id, expected] of [['root-session', 1], ['child-session', 0], ['root-session', 1], ['child-session', 0]]) {
    const event = makeEvent(flavor, id);
    await isolated.invoke(event);
    assert.equal(bootstrapCount(event), expected);
  }
  assert.deepEqual(isolated.lookups, ['root-session', 'child-session']);

  const bounded = await makeHarness(flavor, (id) => reply(flavor, { id, parentID: 'parent' }));
  for (let index = 0; index <= 512; index++) {
    const event = makeEvent(flavor, `eviction-${index}`);
    await bounded.invoke(event);
    assert.equal(bootstrapCount(event), 0);
  }
  const evicted = makeEvent(flavor, 'eviction-0');
  await bounded.invoke(evicted);
  assert.equal(bootstrapCount(evicted), 0);
  assert.equal(bounded.lookups.filter((id) => id === 'eviction-0').length, 2);

  const restarted = await makeHarness(flavor, (id) => reply(flavor, { id, parentID: 'parent' }));
  const afterRestart = makeEvent(flavor, 'eviction-0');
  await restarted.invoke(afterRestart);
  assert.equal(bootstrapCount(afterRestart), 0);
  assert.deepEqual(restarted.lookups, ['eviction-0']);

  const unknown = await makeHarness(flavor, () => { throw new Error('must not look up a missing ID'); });
  const noID = makeEvent(flavor, undefined);
  await unknown.invoke(noID);
  assert.equal(bootstrapCount(noID), 1);
  assert.deepEqual(unknown.lookups, []);
}

function compactedEvent(sessionID) {
  return {
    sessionID,
    system: [],
    messages: [{
      role: 'assistant',
      content: [{ type: 'compaction', provider: 'fixture', encrypted: 'opaque-checkpoint' }],
    }],
  };
}

const compactedRoot = await makeHarness('v2', (id) => ({ id }));
const rootEvent = compactedEvent('compacted-root');
const checkpoint = structuredClone(rootEvent.messages[0]);
await compactedRoot.invoke(rootEvent);
assert.equal(bootstrapCount(rootEvent), 1);
assert.deepEqual(rootEvent.messages[0], checkpoint);
assert.equal(rootEvent.messages.length, 2);
assert.equal(rootEvent.messages[1].role, 'user');
assert.deepEqual(rootEvent.system, []);
await compactedRoot.invoke(rootEvent);
assert.equal(bootstrapCount(rootEvent), 1);
assert.equal(rootEvent.messages.length, 2);
const freshRootEvent = compactedEvent('compacted-root');
await compactedRoot.invoke(freshRootEvent);
assert.equal(bootstrapCount(freshRootEvent), 1);
assert.deepEqual(compactedRoot.lookups, ['compacted-root']);

const compactedChild = await makeHarness('v2', (id) => ({ id, parentID: 'parent' }));
const childEvent = compactedEvent('compacted-child');
const originalChild = structuredClone(childEvent);
await compactedChild.invoke(childEvent);
assert.equal(bootstrapCount(childEvent), 0);
assert.deepEqual(childEvent, originalChild);
assert.deepEqual(compactedChild.lookups, ['compacted-child']);

const retryChild = await makeHarness('v2', (id, call) => {
  if (call === 1) throw new Error('temporary lookup failure');
  return { id, parentID: 'parent' };
});
const unknownChild = compactedEvent('retry-compacted-child');
await retryChild.invoke(unknownChild);
assert.equal(bootstrapCount(unknownChild), 1);
const recoveredChild = compactedEvent('retry-compacted-child');
await retryChild.invoke(recoveredChild);
assert.equal(bootstrapCount(recoveredChild), 0);
assert.equal(recoveredChild.messages.length, 1);
assert.equal(retryChild.lookups.length, 2);

const newPromptAfterCheckpoint = compactedEvent('new-prompt-after-checkpoint-root');
newPromptAfterCheckpoint.messages.push({ role: 'user', content: [{ type: 'text', text: 'Continue' }] });
await compactedRoot.invoke(newPromptAfterCheckpoint);
assert.equal(bootstrapCount(newPromptAfterCheckpoint), 1);
assert.equal(newPromptAfterCheckpoint.messages.length, 2);
assert.equal(newPromptAfterCheckpoint.messages[1].content.length, 2);

const retainedUser = compactedEvent('retained-user-root');
retainedUser.messages.unshift({ role: 'user', content: [{ type: 'text', text: 'Keep going' }] });
const retainedCheckpoint = structuredClone(retainedUser.messages[1]);
await compactedRoot.invoke(retainedUser);
assert.equal(bootstrapCount(retainedUser), 1);
assert.equal(retainedUser.messages.length, 2);
assert.equal(retainedUser.messages[0].content.length, 2);
assert.ok(retainedUser.messages[0].content[0].text.startsWith(marker));
assert.equal(retainedUser.messages[0].content[1].text, 'Keep going');
assert.deepEqual(retainedUser.messages[1], retainedCheckpoint);
await compactedRoot.invoke(retainedUser);
assert.equal(bootstrapCount(retainedUser), 1);
assert.equal(retainedUser.messages.length, 2);

const retainedUserChild = compactedEvent('retained-user-child');
retainedUserChild.messages.unshift({ role: 'user', content: [{ type: 'text', text: 'Keep going' }] });
const originalRetainedUserChild = structuredClone(retainedUserChild);
await compactedChild.invoke(retainedUserChild);
assert.equal(bootstrapCount(retainedUserChild), 0);
assert.deepEqual(retainedUserChild, originalRetainedUserChild);
const empty = { sessionID: 'empty', messages: [] };
await compactedRoot.invoke(empty);
assert.deepEqual(empty.messages, []);


// --- Fork graft: V2 compaction re-composes the beads context once per session.
const recompose = await makeHarness('v2', (id) => ({ id }));
const before = runs();
const compacted = compactedEvent('recompose-root');
await recompose.invoke(compacted);
assert.equal(bootstrapCount(compacted), 1, 'compacted session still gets the bootstrap');
// fresh module: initial load is the refresh itself — exactly one composer exec
assert.equal(runs() - before, 1, 'compaction with no user message re-composes once');
await recompose.invoke(compactedEvent('recompose-root'));
assert.equal(runs() - before, 1, 'a second compacted step in the same session does not re-exec');
await recompose.invoke(compactedEvent('recompose-other'));
assert.equal(runs() - before, 2, 'another compacted session re-composes once');
const plain = makeEvent('v2', 'recompose-plain');
await recompose.invoke(plain);
assert.equal(runs() - before, 2, 'an ordinary request is served from the cache');

console.log('PASS: opencode session bootstrap — child skip, recovery, cache lifetime, V2 compaction re-compose');
