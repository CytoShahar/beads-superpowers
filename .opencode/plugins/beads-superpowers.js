/**
 * beads-superpowers plugin for OpenCode.ai
 *
 * Upstream-parity base: obra/superpowers .opencode/plugins/superpowers.js (v7.0.0)
 * — dual-compatible with OpenCode V1 and V2 (2.0.4+):
 *   V1 (opencode 1.x): named export BeadsSuperpowersPlugin — config hook for
 *     skills registration, experimental.chat.messages.transform for the
 *     bootstrap (first user message, upstream #750/#894).
 *   V2: default export { id, setup } read by the PluginSupervisor — setup()
 *     registers skills natively via ctx.skill.transform() and injects the
 *     bootstrap via ctx.session.hook("context").
 * Both flavors: module-level caching (#1202); delegated child (task subagent)
 * sessions get skills but no controller bootstrap (#2160). Install is the
 * git-backed package spec in opencode.json (see ../INSTALL.md); everything
 * resolves repo-relative — no fallback roots. No external dependencies.
 *
 * Fork delta (minimal, policy-free): bootstrap content comes from the canonical
 * composer `hooks/session-start --emit-plain` (using-superpowers bootstrap +
 * composed <beads-context>); on failure it falls back to a minimal pointer —
 * NEVER the full bd prime dump. No per-flavor tool mapping is injected (the
 * composed skill points at skills/using-superpowers/references/). Plus
 * compaction re-composition (V1 compaction hook; V2 when compaction left no
 * user message). All selection/degradation policy lives in hooks/session-start;
 * the anti-fork guard is tests/hooks/test-opencode-injection.mjs.
 */

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared by V1 (config hook), V2 (setup/ctx.skill.transform) and the composer exec.
const packageRoot = path.resolve(__dirname, '../..');
const skillsDir = path.join(packageRoot, 'skills');

// Simple frontmatter extraction (upstream verbatim; used for V2 skill
// registration). Handles plain `key: value` lines, quoted values (including
// quotes that close on an indented continuation line), YAML block scalar
// markers (`>`, `|`) with indented continuation lines, and CRLF line
// endings. Not a full YAML parser — nested maps flatten into their parent
// key's value, which is fine for the name/description fields consumed here.
const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };

  const frontmatterStr = match[1];
  const body = match[2];
  const frontmatter = {};
  let lastKey = null;

  for (const rawLine of frontmatterStr.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && !/^\s/.test(line)) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      // Block scalar markers (>, |, optionally with +/- chomping) carry no
      // value themselves; the indented lines that follow do.
      frontmatter[key] = /^(>[+-]?|\|[+-]?)$/.test(value) ? '' : value;
      lastKey = key;
    } else if (lastKey !== null && line.trim() !== '') {
      // Continuation of a multi-line value: append rather than drop so long
      // descriptions survive parsing.
      frontmatter[lastKey] = `${frontmatter[lastKey]} ${line.trim()}`.trim();
    }
  }

  // A quoted value may close on a continuation line, so unquote only once
  // the value is fully assembled: strip exactly one matching surrounding
  // pair and leave unbalanced quotes alone.
  for (const key of Object.keys(frontmatter)) {
    frontmatter[key] = frontmatter[key].replace(/^(["'])([\s\S]*)\1$/, '$2');
  }

  return { frontmatter, content: body };
};

// --- Bootstrap (fork graft: canonical composer + pointer fallback) ----------

// Module-level cache for bootstrap content (upstream #1202 pattern).
// undefined = not yet loaded; a string = cached payload (composed or pointer).
let _bootstrapCache = undefined;

// Exec the canonical composer. Returns null on failure OR on the composer's
// event-dedup yielding an empty rapid re-run — a real payload always carries
// the <EXTREMELY_IMPORTANT> injection marker.
const composeBootstrap = () => {
  try {
    const text = execSync(
      `"${path.join(packageRoot, 'hooks/session-start')}" --emit-plain 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
    return text.includes('EXTREMELY_IMPORTANT') ? text : null;
  } catch {
    return null;
  }
};

const getBootstrapContent = () => {
  if (_bootstrapCache !== undefined) return _bootstrapCache;

  const composed = composeBootstrap();
  if (composed) {
    _bootstrapCache = composed;
    return _bootstrapCache;
  }

  // Policy-free pointer fallback (composer missing/failed). Wrapped in the
  // marker so the injection guards below stay idempotent.
  let memLine = '';
  try {
    memLine = execSync('bd memories 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).split('\n')[0] ?? '';
  } catch {
    // bd absent
  }
  _bootstrapCache = [
    '<EXTREMELY_IMPORTANT>',
    'beads-superpowers: session composer unavailable in this environment.',
    'Load skills via the skill tool (start: using-superpowers).',
    memLine ? `${memLine} — search: bd memories <keyword>, fetch: bd recall <key>` : '',
    '</EXTREMELY_IMPORTANT>',
  ].filter(Boolean).join('\n');
  return _bootstrapCache;
};

// Re-compose after compaction: beads state has moved on since the cached
// payload, and a pointer cached while the composer was briefly unavailable is
// promoted here. Keeps the old cache when the composer fails or dedups.
const refreshBootstrap = () => {
  const fresh = composeBootstrap();
  if (fresh) _bootstrapCache = fresh;
  return fresh;
};

// --- Session bookkeeping ----------------------------------------------------

// Bounded per-session memo. The V2 service process is long-lived and sessions
// accumulate over weeks, so when full drop the oldest quarter (Map iterates
// keys in insertion order). An evicted session merely pays one extra lookup.
const SESSION_CACHE_MAX = 512;
const _remember = (map, key, value) => {
  if (map.size >= SESSION_CACHE_MAX) {
    let toDrop = Math.ceil(SESSION_CACHE_MAX / 4);
    for (const k of map.keys()) {
      if (toDrop-- <= 0) break;
      map.delete(k);
    }
  }
  map.set(key, value);
};

// #2160: the bootstrap drives controller workflows (brainstorming, planning,
// approval cycles). Injecting it into task subagent sessions makes workers
// restart design/approval cycles for work the parent already authorised.
// A parentID on the session is the child signal on both flavors, so when the
// session carrying the message has one we skip bootstrap injection. Skills
// stay registered for every session — workers keep explicit access to them.
// sessionID -> is-child decision (parentID never changes for a session).
const _childSessionCache = new Map();

const isChildSession = async (fetchSession, sessionID) => {
  if (!sessionID) return false; // unknown session: keep current behavior
  if (_childSessionCache.has(sessionID)) return _childSessionCache.get(sessionID);

  let isChild = false;
  try {
    const result = await fetchSession(sessionID);
    // V1 returns a successful SDK envelope while V2 returns a direct session
    // record. Validate both shapes before classifying or caching the result;
    // resolved SDK errors must follow the same fail-open path as rejections.
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Session lookup returned no usable record');
    }
    if (result.error != null || result.response?.ok === false) {
      throw new Error('Session lookup was unsuccessful');
    }
    const session = 'data' in result ? result.data : result;
    if (!session || typeof session !== 'object' || Array.isArray(session) || session.id !== sessionID) {
      throw new Error('Session lookup returned an invalid session identity');
    }
    if (session.parentID !== undefined &&
        (typeof session.parentID !== 'string' || session.parentID.length === 0)) {
      throw new Error('Session lookup returned an invalid parent identity');
    }
    isChild = session.parentID !== undefined;
  } catch (err) {
    // Fail open: on lookup errors keep injecting (previous behavior) and do
    // not cache, so a transient failure can recover on the next step.
    console.error('[beads-superpowers] session lookup failed, treating session as top-level:', err);
    return false;
  }
  _remember(_childSessionCache, sessionID, isChild);
  return isChild;
};

// Fork graft (V2): sessions already re-composed after compaction, so a run of
// agent steps with no surviving user message pays one composer exec, not one
// per step.
const _refreshedSessions = new Map();

/**
 * V1 Plugin Function (named export + default.server)
 */
export const BeadsSuperpowersPlugin = async ({ client, directory }) => {
  return {
    // Upstream: inject the skills path into live config so OpenCode discovers
    // the bundled skills without symlinks or config edits.
    config: async (config) => {
      // V2: skills is a flat array — skip, setup() handles V2 skill registration
      if (Array.isArray(config.skills)) return;

      // V1: skills is { paths: [...] }
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    // Upstream: inject bootstrap into the first user message of each
    // top-level session. Fires on every agent step; the cache + marker guard
    // keep it idempotent.
    'experimental.chat.messages.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent();
      if (!bootstrap || !output.messages.length) return;
      const firstUser = output.messages.find(m => m.info.role === 'user');
      if (!firstUser || !firstUser.parts.length) return;
      if (firstUser.parts.some(p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) return;

      // #2160: V1 passes no input to this hook, so take the sessionID from the
      // message record itself.
      if (client && await isChildSession(
        (id) => client.session.get({ path: { id } }),
        firstUser.info.sessionID,
      )) return;

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
    },

    // Fork delta: compaction resilience — re-compose fresh beads context after
    // context-window compaction.
    'experimental.session.compacting': async (_input, output) => {
      const fresh = refreshBootstrap();
      output.context.push(fresh || 'beads-superpowers is installed. Run skills via the skill tool.');
    },
  };
};

/**
 * V2 Setup Function (default.setup)
 *
 * 1. Registers every skills/<name>/SKILL.md as a native Skill.Info object via
 *    ctx.skill.transform((draft) => draft.add(info)) — OpenCode 2.0.4 contract
 *    { id, name, description?, path, content } (`path`, renamed from
 *    `location` in v2.0.4).
 * 2. Injects the bootstrap via ctx.session.hook("context"), the V2 equivalent
 *    of V1's experimental.chat.messages.transform.
 */
async function setup(ctx) {
  // V1 also invokes default.setup, with a ctx lacking the skill/session
  // domains. Return quietly — V1 is served by the named export.
  if (!ctx || !ctx.skill || typeof ctx.skill.transform !== 'function' || !ctx.session || typeof ctx.session.hook !== 'function') {
    return;
  }

  // 1. Register skills (one transform; one draft.add per skill)
  try {
    const skills = [];
    if (fs.existsSync(skillsDir)) {
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue;
        const { frontmatter, content } = extractAndStripFrontmatter(fs.readFileSync(skillPath, 'utf8'));
        skills.push({
          id: entry.name,
          name: frontmatter.name || entry.name,
          ...(frontmatter.description ? { description: frontmatter.description } : {}),
          path: skillPath,
          content,
        });
      }
    }
    await ctx.skill.transform((draft) => {
      // A throw escaping this callback makes the host hard-disable the whole
      // plugin (skills AND bootstrap). Contain failures per skill.
      for (const skill of skills) {
        try {
          draft.add(skill);
        } catch (err) {
          console.error(`[beads-superpowers] skill "${skill.id}" rejected by host, skipping:`, err);
        }
      }
    });
  } catch (err) {
    // Never break plugin activation: one failing plugin takes down the whole
    // V2 generation (including provider/catalog plugins => no models in TUI).
    console.error('[beads-superpowers] skill registration failed:', err);
  }

  // 2. Inject bootstrap into first user message via V2 session context hook
  try {
    await ctx.session.hook('context', async (event) => {
      try {
        if (!event.messages || !event.messages.length) return;
        const firstUser = event.messages.find(m => m.role === 'user');
        if (firstUser && (!firstUser.content || !firstUser.content.length)) return;
        if (firstUser?.content.some(p => p.type === 'text' && p.text && p.text.includes('EXTREMELY_IMPORTANT'))) return;

        // #2160: skip the controller bootstrap in task subagent (child) sessions.
        if (typeof ctx.session.get === 'function' && await isChildSession(
          (id) => ctx.session.get({ sessionID: id }),
          event.sessionID,
        )) return;

        // Fork graft: native compaction removed every user message — re-compose
        // the beads context once for this session before re-injecting.
        if (!firstUser && event.sessionID && !_refreshedSessions.has(event.sessionID)) {
          _remember(_refreshedSessions, event.sessionID, true);
          refreshBootstrap();
        }
        const bootstrap = getBootstrapContent();
        if (!bootstrap) return;

        // Native compaction can leave only an opaque checkpoint. Keep it
        // intact and append the transient bootstrap as a user message.
        if (firstUser) {
          firstUser.content.unshift({ type: 'text', text: bootstrap });
        } else {
          event.messages.push({ role: 'user', content: [{ type: 'text', text: bootstrap }] });
        }
      } catch (err) {
        // Never let hook callback errors break the request pipeline.
        console.error('[beads-superpowers] context hook failed:', err);
      }
    });
  } catch (err) {
    console.error('[beads-superpowers] session hook registration failed:', err);
  }
}

/**
 * Default Export: { id, server, setup }
 * V2 PluginSupervisor reads { id, setup }; V1 reads the named export.
 */
export default {
  id: 'beads-superpowers',
  server: BeadsSuperpowersPlugin,
  setup,
};
