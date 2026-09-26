import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { hasSessionIdentity, isClaudeProcess, isSessionOwnerAlive, processEntryFor, readProcessTable } from "./process-liveness.js";
import { isKnownSession, readSessionLedger } from "./session-proof.js";
import { noteForProcess, readSessionRegistry, registryEntryFor } from "./session-registry.js";
import { chooseFamiliar, displayName, familiarByType } from "./familiars.js";
import { sanitizeHookEvent, VISUAL_STATES } from "./state-machine.js";

const mime = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml; charset=utf-8"
};

export function createDaemonwoodServer({
  root,
  identity = {},
  token = null,
  onShutdown = null,
  maxBodyBytes = 64 * 1024,
  processSnapshot = readProcessTable,
  ledgerSnapshot = readSessionLedger,
  registrySnapshot = readSessionRegistry,
  reapIntervalMs = 2_000,
  heartbeatIntervalMs = 15_000,
  /* Whether Claude Code is set up to report to this bridge — the hooks in
     the user's settings and the status line — read by whoever owns those
     files (server.mjs hands in the installer's own check). The page shows the
     answer in its top bar, so "is it connected?" is answered where the map
     is, not only by `npm run status`. `null` means nobody is checking. */
  setupSnapshot = null,
  setupIntervalMs = 15_000,
  /* Which face each session wore, kept across restarts (see
     familiar-ledger.js). `null` remembers nothing beyond this run. */
  familiarLedger = null,
  /* How long a note is given to catch up with a hook that beat it to the
     bridge. `/clear` writes a new session id into the note and fires
     SessionStart for it; whichever lands first, the other is only ever a
     moment behind. */
  registryGraceMs = 600,
  /* The source checkout's review pages (docs/art-review.html). Only
     `npm run dev` turns this on; the installed service never serves docs. */
  devFiles = false
} = {}) {
  const clients = new Set();
  const sessions = new Map();
  /* Sessions that have just left, and when. A process takes a moment to exit
     after its SessionEnd hook runs, and its note is on disk until it does —
     long enough for discovery to bring a session back that has already said
     goodbye. A session that ended stays ended; a resumed one announces itself
     through the door, which does not consult this. */
  const farewells = new Map();
  const FAREWELL_MS = 60_000;
  let receivedEvents = 0;
  let hookEvents = 0;
  let lastHookReceivedAt = null;
  const deliveryState = () => ({ hookEvents, lastHookReceivedAt });
  let refusedEvents = 0;
  let lastRefusal = null;
  let lastEventAt = null;
  const startedAt = new Date().toISOString();

  /* `ps` is the bridge's only witness, and the reaper already asks it for a
     table every couple of seconds. Events reuse that answer rather than forking
     a process per hook — but never to refuse one. A table older than the
     process it is being asked about would turn a session that just started into
     a forgery, so every verdict of "no such process" is re-checked against a
     fresh table before it costs anyone a familiar. */
  const cached = (read) => {
    let state = { at: 0, value: null };
    return ({ fresh = false } = {}) => {
      if (fresh || Date.now() - state.at >= reapIntervalMs) state = { at: Date.now(), value: read() };
      return state.value;
    };
  };
  const processTable = cached(processSnapshot);
  /* Claude Code's transcript ledger and its session notes get the same
     treatment: cached between sweeps, re-read fresh before any refusal. */
  const sessionLedger = cached(ledgerSnapshot);
  const sessionRegistry = cached(registrySnapshot);

  /* The install check is a file read, refreshed on the heartbeat so a
     `connect` run in another terminal shows in the bar within a beat. */
  let setup = { at: 0, value: null };
  const setupState = async () => {
    if (!setupSnapshot) return null;
    if (Date.now() - setup.at < setupIntervalMs) return setup.value;
    try {
      setup = { at: Date.now(), value: (await setupSnapshot()) || null };
    } catch {
      setup = { at: Date.now(), value: null };
    }
    return setup.value;
  };

  const witnesses = ({ fresh = false } = {}) => ({
    processes: processTable({ fresh }), ledger: sessionLedger({ fresh }), registry: sessionRegistry({ fresh })
  });

  /* One door in. Everything that reaches the map — a hook's event, the
     bridge's own correction from Claude Code's note, a session discovered at
     startup — is admitted here, so there is exactly one place that names a
     familiar, keeps the snapshot and tells the page. */
  const admit = (safe, { supersedes = null, processes = processTable(), registry = sessionRegistry() } = {}) => {
    let inherited = null;
    if (supersedes && sessions.has(supersedes)) {
      inherited = sessions.get(supersedes);
      removeSession(sessions, supersedes, "superseded", (event) => broadcast(clients, event));
      farewells.set(supersedes, Date.now());
    }
    if (safe.removesSession) farewells.set(safe.sessionId, Date.now());
    receivedEvents += 1;
    lastEventAt = safe.timestamp;
    identifySession(safe, sessions, processes, registry, inherited, familiarLedger?.recall(safe.sessionId));
    updateSnapshot(sessions, safe);
    if (!safe.removesSession) {
      const held = sessions.get(safe.sessionId);
      familiarLedger?.remember(safe.sessionId, { familiarType: held?.familiarType, terminalProgram: held?.terminalProgram });
    }
    broadcast(clients, safe);
    return safe;
  };

  const server = createServer(async (request, response) => {
    const port = server.address()?.port;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowedHosts.has(request.headers.host)) { response.writeHead(403).end("Local requests only"); return; }
    if (request.headers.origin && !allowedHosts.has(request.headers.origin.replace(/^http:\/\//, ""))) { response.writeHead(403).end("Origin not allowed"); return; }
    let url;
    try { url = new URL(request.url, `http://127.0.0.1:${port}`); }
    catch { response.writeHead(400).end(); return; }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (request.method === "POST" && token && request.headers.authorization !== `Bearer ${token}`) { json(response, 401, { ok: false, error: "Local adapter credential required" }); return; }

    if (request.method === "POST" && url.pathname === "/api/shutdown" && onShutdown) {
      json(response, 200, { ok: true });
      setTimeout(onShutdown, 20);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, {
        ok: true, product: "daemonwood", protocol: 1, ...identity, clients: clients.size, sessions: sessions.size,
        receivedEvents, refusedEvents, lastRefusal, lastEventAt, startedAt,
        setup: await setupState(), delivery: deliveryState()
      });
      return;
    }

    /* Who a session is, for the terminal that owns it. A status line hands over
       its session id and gets the familiar back, so the tab can say "Moss" in
       the same words the map does. Nothing here that the stream does not
       already broadcast to the page. */
    if (request.method === "GET" && url.pathname === "/api/sessions") {
      json(response, 200, [...sessions.values()].map(publicSession));
      return;
    }
    const sessionLookup = request.method === "GET" && /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (sessionLookup) {
      const session = sessions.get(decodeURIComponent(sessionLookup[1]));
      if (session) json(response, 200, publicSession(session));
      else json(response, 404, { ok: false, error: "No such session on the map" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      });
      response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, setup: await setupState(), delivery: deliveryState() })}\n\n`);
      response.write(`event: daemonwood-snapshot\ndata: ${JSON.stringify([...sessions.values()])}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/events") {
      try {
        const raw = await readJson(request, maxBodyBytes);
        const safe = sanitizeHookEvent(raw);
        if (!safe) {
          json(response, 422, { ok: false, error: "Unsupported event" });
          return;
        }

        let verdict = verifyEventOwner(safe, sessions, witnesses());
        if (verdict.recheck) verdict = verifyEventOwner(safe, sessions, witnesses({ fresh: true }));
        /* A note that names a different session may simply not have been
           rewritten yet. Ask again, briefly, before calling it a forgery. */
        for (let waited = 0; verdict.recheck && verdict.noteMismatch && waited < registryGraceMs; waited += 200) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          verdict = verifyEventOwner(safe, sessions, witnesses({ fresh: true }));
        }
        if (!verdict.ok) {
          refusedEvents += 1;
          lastRefusal = {
            at: new Date().toISOString(),
            sessionId: safe.sessionId,
            agentName: safe.agentName,
            reason: verdict.reason
          };
          send(clients, "daemonwood-refused", lastRefusal);
          json(response, 403, { ok: false, error: verdict.reason });
          return;
        }

        admit(safe, { supersedes: verdict.supersedes });
        hookEvents += 1;
        lastHookReceivedAt = new Date().toISOString();
        send(clients, "daemonwood-delivery", deliveryState());
        json(response, 202, { ok: true, event: safe });
      } catch (error) {
        const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
        json(response, status, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD, POST" }).end();
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const relative = normalize(requested).replace(/^[/\\]+/, "");
    const backend = /(?:event-server|process-liveness|session-proof|session-registry|familiar-ledger|local-paths)\.js$/;
    const publicFile = relative === "index.html" ||
      (/^src\/(?:[a-z-]+\.(?:js|css)|design\/tokens\.js)$/.test(relative) && !backend.test(relative)) ||
      /^assets\/(?:map|sprites|palette)\/[a-zA-Z0-9_./-]+\.(?:png|svg|json|tmj)$/.test(relative) ||
      (devFiles && /^docs\/[a-z-]+\.(?:html|js)$/.test(relative));
    const file = resolve(root, relative);
    if (!publicFile || !file.startsWith(resolve(root) + sep)) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error("not a file");
      response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  /* The sweep. Every couple of seconds the bridge re-asks its witnesses and
     settles four things, in this order: who has gone, who has been renamed or
     moved terminals, whose state Claude Code now describes differently than
     the last hook did, and who is running that the map has never heard
     from. */
  const sweep = () => {
    const seen = witnesses({ fresh: true });
    const emit = (event) => {
      if (event.removesSession) farewells.set(event.sessionId, Date.now());
      broadcast(clients, event);
    };
    for (const [id, at] of farewells) if (Date.now() - at > FAREWELL_MS) farewells.delete(id);
    reapDeadSessions(sessions, seen.processes, emit, undefined, seen.ledger, seen.registry);
    for (const session of refreshIdentities(sessions, seen.processes, seen.registry)) {
      send(clients, "daemonwood-session", session);
    }
    for (const correction of reconcileWithRegistry(sessions, seen.processes, seen.registry)) {
      admit(correction, { processes: seen.processes, registry: seen.registry });
    }
    for (const arrival of discoverSessions(sessions, seen.processes, seen.registry, { recentlyEnded: farewells, ledger: seen.ledger })) {
      admit(arrival, { processes: seen.processes, registry: seen.registry });
    }
  };
  const reaper = setInterval(sweep, reapIntervalMs);
  reaper.unref();
  server.on("listening", sweep);

  /* A quiet workshop and a dead stream look identical on screen, and one of
     them is a lie. This beat is the difference: the page hears it, so silence
     it can measure means the bridge really has stopped talking. A comment frame
     would keep the socket warm but stay invisible to the page, so it is a named
     event instead. */
  const heartbeat = setInterval(async () => {
    const payload = JSON.stringify({ at: new Date().toISOString(), sessions: sessions.size, setup: await setupState(), delivery: deliveryState() });
    for (const client of clients) client.write(`event: daemonwood-beat\ndata: ${payload}\n\n`);
  }, heartbeatIntervalMs);
  heartbeat.unref();

  server.on("close", () => {
    clearInterval(reaper);
    clearInterval(heartbeat);
  });

  return server;
}

/* The line between a familiar and a picture of one.

   Every event must name a live Claude Code process, and the bridge checks that
   name against `ps` itself: the payload's claim is never its own proof. This is
   the door the seeded demo cast walked through — a handful of POSTs with no
   process behind them put four agents on the map, one of them asking for
   permission that nobody could grant.

   A pid alone turned out to be the wrong proof, and the demo cast came back
   wearing it: a sender that reads `ps` can stamp four invented sessions with
   the pids of four real ones and pass every check here. A process proves a
   process. So the door asks Claude Code which session that process is hosting.
   Claude Code writes that down itself, in a note per pid, the second the
   process starts — and what the note says outranks what the sender says:

   - the note names this session: admitted, whatever the transcript ledger
     says (a transcript appears at the first prompt, which can be minutes after
     SessionStart, and a session refused for arriving early is a session the
     map lies about);
   - the note names a different session: refused. A borrowed pid with a real
     old session id from the ledger passes every other check and fails this
     one. The one honest way this happens is `/clear`, which is why the door
     re-reads the note briefly before deciding, and why the sweep retires the
     old session the moment the note moves on;
   - no usable note (a build that writes none, or a note left by an earlier
     life of the pid): the transcript ledger decides, as it did before, and one
     pid may speak for one session.

   A probe that fails proves nothing either way. */
export function verifyEventOwner(event, sessions = new Map(), { processes = null, ledger = null, registry = null } = {}) {
  if (!hasSessionIdentity(event)) {
    return { ok: false, reason: "no process identity: nothing proves this session exists" };
  }

  /* A session's last word can outlive the process that sent it, and a session
     we already admitted has already answered all of this. Accept a removal from
     a session we know by that exact pid — it can only take a familiar away,
     never conjure one. */
  const known = sessions.get(event.sessionId);
  const knownRemoval = Boolean(event.removesSession) && known?.ownerPid === event.ownerPid;
  if (knownRemoval) return { ok: true };

  const entry = processEntryFor(event.ownerPid, processes);
  const note = noteForProcess(event.ownerPid, entry, registry);
  const noteSays = note?.sessionId || null;

  if (noteSays && noteSays !== event.sessionId) {
    return { ok: false, recheck: true, noteMismatch: true, reason: `pid ${event.ownerPid} is hosting session ${noteSays}, not ${event.sessionId}` };
  }
  if (!noteSays && isKnownSession(event.sessionId, ledger) === false) {
    return { ok: false, recheck: true, reason: `Claude Code has no session ${event.sessionId}` };
  }

  /* An unreadable process table proves nothing either way, and refusing on it
     would blank the map every time `ps` hiccups. Admit the event; the sweep
     re-checks every session against a real table within a couple of seconds. */
  if (!Array.isArray(processes)) return { ok: true };

  if (!entry) {
    return { ok: false, recheck: true, reason: `no live process ${event.ownerPid}` };
  }
  if (event.ownerStartedAt && entry.startedAt !== event.ownerStartedAt) {
    return { ok: false, reason: `pid ${event.ownerPid} now belongs to a later process` };
  }
  if (!isClaudeProcess(entry)) {
    return { ok: false, reason: `pid ${event.ownerPid} is not a Claude Code session` };
  }

  /* One process, one session. A `claude` hosts exactly one, so a pid that is
     already standing for somebody else on the map is being worn, not owned —
     unless Claude Code's own note says the newcomer is the one it hosts now,
     which is what `/clear` looks like: same process, same terminal, new
     session id. Then the incumbent is the one that is over, and the newcomer
     inherits its place. Without a note the session already holding the pid
     keeps it, and a pid whose holder has died is released by the sweep before
     anyone can inherit it. */
  const incumbent = [...sessions.values()].find((session) =>
    session.sessionId !== event.sessionId &&
    session.ownerPid === event.ownerPid &&
    isSessionOwnerAlive(session, processes) !== false);
  if (incumbent && noteSays === event.sessionId) return { ok: true, supersedes: incumbent.sessionId };
  if (incumbent) {
    return { ok: false, reason: `pid ${event.ownerPid} already speaks for another session` };
  }

  return { ok: true };
}

/* What ties a familiar to the terminal it lives in, decided here and nowhere
   else. The familiar is chosen once per session, at admission, from the species
   no other live session wears — so the name the status line prints and the
   sprite the map draws are one choice. A session that takes over its
   terminal from another (`/clear`) keeps that terminal's face, and a session
   the bridge has seen before — in an earlier run of the bridge — keeps the
   face it wore then, unless a live session is wearing it now. The tty comes
   from the process table the door already consulted, and the session name
   from Claude Code's own note about the session. None of it is anything a
   sender gets to claim. */
export function identifySession(event, sessions, processes, registry, inherited = null, remembered = null) {
  if (event.removesSession) return event;
  const current = sessions.get(event.sessionId);
  const taken = [...sessions.values()]
    .filter((session) => session.sessionId !== event.sessionId)
    .map((session) => session.familiarType);
  const recalled = remembered?.familiarType && !taken.includes(remembered.familiarType) && familiarByType(remembered.familiarType)
    ? remembered.familiarType
    : null;
  event.familiarType = current?.familiarType || inherited?.familiarType || recalled || chooseFamiliar(event.sessionId, taken).type;
  const terminalProgram = inherited?.terminalProgram || remembered?.terminalProgram;
  if (!event.terminalProgram && terminalProgram) event.terminalProgram = terminalProgram;
  const entry = processEntryFor(event.ownerPid, processes);
  if (entry?.tty) event.terminalTty = entry.tty;
  const note = registryEntryFor(event, registry, entry);
  if (note?.name) {
    event.sessionName = note.name;
    if (note.nameSource) event.sessionNameSource = note.nameSource;
  }
  if (note?.repository && (!event.repository || event.repository === "unlabeled-repo")) event.repository = note.repository;
  return event;
}

/* A session can be renamed mid-flight, and a name is worth a line on the map
   the moment it changes. Returns the sessions whose identity moved. */
export function refreshIdentities(sessions, processes, registry) {
  const changed = [];
  for (const session of sessions.values()) {
    const entry = processEntryFor(session.ownerPid, processes);
    const note = registryEntryFor(session, registry, entry);
    const name = note?.name || null;
    const nameSource = (name && note.nameSource) || null;
    const tty = entry?.tty || null;
    const moved = (name && name !== session.sessionName) || (tty && tty !== session.terminalTty) ||
      (nameSource && nameSource !== session.sessionNameSource);
    if (!moved) continue;
    if (name) {
      session.sessionName = name;
      session.sessionNameSource = nameSource;
    }
    if (tty) session.terminalTty = tty;
    changed.push(session);
  }
  return changed;
}

/* Claude Code's note says, in its own words, whether a session is waiting on
   a dialog, busy, or idle with the turn handed back. Hooks say the same
   things — but there are gaps only the note can close:

   - a permission is granted and the tool runs for five minutes: no hook fires
     until the tool ends, so the map keeps saying "Needs you" at a prompt
     nobody is waiting behind. The note flips to busy the moment the dialog
     closes;
   - Escape interrupts a turn: no Stop hook runs, the map says "Running
     command" for as long as the session sits there. The note says idle;
   - a hook is lost — bridge down for a second, a hook past its timeout — and
     the last state the map heard is the one it keeps.

   So the sweep lets the note correct the map, and only the map: a note newer
   than the last event the session sent, describing a different kind of state
   than the map shows, becomes an event of the bridge's own — timestamped
   when the note changed, so a hook that arrives later still wins. A note the
   same age as the last event, or older, says nothing the hooks did not.
   Idle never disturbs a session that is merely Starting or already Done, and
   busy never wakes one that is Starting: those are the hooks' to settle. */
const restingStates = new Set([VISUAL_STATES.ARRIVING, VISUAL_STATES.FINISHED, VISUAL_STATES.IDLE]);
const busyOverrides = new Set([VISUAL_STATES.NEEDS_INPUT, VISUAL_STATES.FINISHED, VISUAL_STATES.IDLE]);

export function correctionFor(session, note) {
  if (!note?.status || !Number.isFinite(note.statusUpdatedAt)) return null;
  const last = Date.parse(session.timestamp || "");
  if (Number.isFinite(last) && note.statusUpdatedAt <= last) return null;
  const state = session.visualState;
  let type = null;
  let category;
  if (note.status === "waiting" && state !== VISUAL_STATES.NEEDS_INPUT) type = "needs_input";
  else if (note.status === "idle" && !restingStates.has(state)) type = "stopped";
  else if (note.status === "busy" && busyOverrides.has(state)) {
    type = session.workCategory ? "tool_started" : "prompt_submitted";
    category = session.workCategory || undefined;
  }
  if (!type) return null;
  return bridgeEvent(session, type, note.statusUpdatedAt, category);
}

export function reconcileWithRegistry(sessions, processes, registry) {
  const corrections = [];
  for (const session of sessions.values()) {
    const entry = processEntryFor(session.ownerPid, processes);
    const correction = correctionFor(session, registryEntryFor(session, registry, entry));
    if (correction) corrections.push(sanitizeHookEvent(correction));
  }
  return corrections;
}

/* Sessions that are running and have never reached the map: opened before the
   bridge was, or before the hooks were installed, or while it was restarting.
   Claude Code's note is the proof — one per live process, written by nothing
   else — and its status is the state, which the next hook refines. The
   process has to be there, be Claude Code, and have started when the note
   says it did; a note without a session id or a status describes nothing the
   map can draw.

   An idle note is ambiguous: Claude Code writes `idle` the moment a process
   starts, before anyone has typed a word, and again at the end of every turn.
   The transcript ledger tells the two apart — a transcript appears at the
   first prompt — so an idle session with no transcript is one that has only
   just opened, and it arrives at the workbench as Starting, not at the dock
   as Done. A ledger that cannot be read proves nothing, and idle stays Done. */
export function discoverSessions(sessions, processes, registry, { recentlyEnded = new Map(), ledger = null } = {}) {
  if (!(registry instanceof Map) || !Array.isArray(processes)) return [];
  const heldPids = new Set([...sessions.values()].map((session) => session.ownerPid));
  const arrivals = [];
  for (const [pid, note] of registry) {
    if (!note.sessionId || !note.status || sessions.has(note.sessionId) || heldPids.has(pid)) continue;
    if (recentlyEnded.has(note.sessionId)) continue;
    const entry = processEntryFor(pid, processes);
    if (!entry || !isClaudeProcess(entry) || !noteForProcess(pid, entry, registry)) continue;
    const at = note.statusUpdatedAt || note.updatedAt || note.startedAt || Date.now();
    const type = note.status === "waiting" ? "needs_input"
      : note.status === "idle" ? (isKnownSession(note.sessionId, ledger) === false ? "session_started" : "stopped")
      : "prompt_submitted";
    arrivals.push(sanitizeHookEvent({
      id: `${note.sessionId}:discovered:${at}`,
      sessionId: note.sessionId,
      agentName: "Claude",
      timestamp: new Date(at).toISOString(),
      type,
      repository: note.repository || undefined,
      ownerPid: pid,
      ownerStartedAt: entry.startedAt
    }));
  }
  return arrivals;
}

function bridgeEvent(session, type, at, category) {
  return {
    id: `${session.sessionId}:${type}:${at}`,
    sessionId: session.sessionId,
    agentName: session.agentName,
    timestamp: new Date(at).toISOString(),
    type,
    category,
    repository: session.repository,
    taskLabel: session.taskLabel,
    ownerPid: session.ownerPid,
    ownerStartedAt: session.ownerStartedAt,
    terminalProgram: session.terminalProgram
  };
}

export function publicSession(session) {
  const familiar = familiarByType(session.familiarType);
  return {
    sessionId: session.sessionId,
    familiar: familiar ? { type: familiar.type, name: familiar.name, species: familiar.species } : null,
    agentName: displayName(session.agentName, familiar) || session.agentName,
    sessionName: session.sessionName || null,
    /* How the session got its name — "user" for /rename — so the page can
       tell a chosen name from Claude Code's fallback slug. */
    sessionNameSource: session.sessionNameSource || null,
    terminalProgram: session.terminalProgram || null,
    terminalTty: session.terminalTty || null,
    repository: session.repository,
    visualState: session.visualState || null,
    lastEventAt: session.timestamp
  };
}

export function reapDeadSessions(sessions, processes, emit = () => {}, now = () => new Date(), ledger = null, registry = null) {
  const at = now();
  let removed = 0;
  for (const [key, session] of sessions) {
    const reason = expiryReason(session, processes, ledger, registry);
    if (!reason) continue;
    removeSession(sessions, key, reason, emit, at);
    removed += 1;
  }
  return removed;
}

function removeSession(sessions, key, reason, emit, at = new Date()) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  emit({
    ...session,
    id: `${session.sessionId}:${reason}:${at.getTime()}`,
    timestamp: at.toISOString(),
    type: reason,
    visualState: null,
    removesSession: true,
    requiresAttention: false,
    subagentDelta: 0,
    subagentCount: 0
  });
}

/* Proof beats guessing, in both directions. A session leaves only when its
   process is demonstrably gone — however long it has been quiet, and never
   because a `ps` probe failed. There is no silence timeout here and no
   unidentified session for one to catch: the door refuses anything that cannot
   name a live process, so every session on the map has one to check.

   The same sweep re-asks Claude Code's note. A process whose note now names
   a different session has moved on (`/clear`), and the old session is over
   even though the process is not. A session with no note to vouch for it is
   held to the transcript ledger, as before: a fake admitted while the ledger
   could not be read is taken down by the first sweep that can read it. An
   unreadable witness still proves nothing and removes nobody. */
function expiryReason(session, processes, ledger = null, registry = null) {
  if (isSessionOwnerAlive(session, processes) === false) return "disconnected";
  const note = noteForProcess(session.ownerPid, processEntryFor(session.ownerPid, processes), registry);
  if (note?.sessionId) return note.sessionId === session.sessionId ? null : "superseded";
  return isKnownSession(session.sessionId, ledger) === false ? "unproven" : null;
}

function broadcast(clients, event) {
  send(clients, "daemonwood-event", event);
}

function send(clients, name, payload) {
  const body = JSON.stringify(payload);
  for (const client of clients) client.write(`event: ${name}\ndata: ${body}\n\n`);
}

function updateSnapshot(sessions, event) {
  const key = event.sessionId;
  if (event.removesSession) {
    const current = sessions.get(key);
    if (current && isOlder(event.timestamp, current.timestamp)) return;
    sessions.delete(key);
    return;
  }
  const current = sessions.get(key) || { ...event, subagentCount: 0 };
  if (isOlder(event.timestamp, current.timestamp)) return;
  const subagentCount = Math.max(0, (current.subagentCount || 0) + (event.subagentDelta || 0));
  sessions.set(key, {
    ...current,
    ...event,
    // The sanitizer fills a missing label with a placeholder, so a later event
    // that simply does not carry one — a permission prompt, a subagent count —
    // must not overwrite the project and task this session already told us.
    agentName: keepKnown(event.agentName, current.agentName, "Agent"),
    repository: keepKnown(event.repository, current.repository, "unlabeled-repo"),
    taskLabel: keepKnown(event.taskLabel, current.taskLabel, "Unlabeled task"),
    familiarType: current.familiarType || event.familiarType,
    sessionName: event.sessionName || current.sessionName,
    sessionNameSource: event.sessionName ? (event.sessionNameSource || null) : current.sessionNameSource,
    terminalProgram: event.terminalProgram || current.terminalProgram,
    terminalTty: event.terminalTty || current.terminalTty,
    visualState: event.visualState || current.visualState,
    /* The last kind of work this session was doing, so that when a dialog
       closes the familiar goes back to the station it left, not to a
       generic one. */
    workCategory: event.type === "tool_started" && event.category ? event.category : current.workCategory,
    subagentDelta: 0,
    subagentCount
  });
}

function keepKnown(incoming, existing, placeholder) {
  if (incoming && incoming !== placeholder) return incoming;
  return existing || incoming;
}

function isOlder(incoming, current) {
  const incomingTime = Date.parse(incoming || "");
  const currentTime = Date.parse(current || "");
  return Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime < currentTime;
}

async function readJson(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) throw new Error("Request body is required");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}
