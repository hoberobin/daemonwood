import { execFileSync } from "node:child_process";

const claudeProcessPattern = /(?:^|\s)(?:\S*[\\/])?claude(?:\s|$)/i;

/* The single test for "this pid is a Claude Code session". The hook walks its
   ancestry with it to find its owner; the bridge checks incoming events against
   it so a pid that belongs to something else — or to nothing — cannot put a
   familiar on the map. One pattern, so the two can never disagree. */
export function isClaudeProcess(entry) {
  return claudeProcessPattern.test(entry?.command || "");
}

// A hook is a short-lived child process. Walk its ancestry to find the
// long-lived `claude` process that owns the session. The start time protects
// against a dead process's PID later being reused by an unrelated process.
export function findSessionOwner({ startPid = process.ppid, processes = readProcessTable() } = {}) {
  if (!Array.isArray(processes)) return null;
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const visited = new Set();
  let pid = Number(startPid);

  while (Number.isSafeInteger(pid) && pid > 1 && !visited.has(pid)) {
    visited.add(pid);
    const entry = byPid.get(pid);
    if (!entry) return null;
    if (isClaudeProcess(entry)) {
      return { ownerPid: entry.pid, ownerStartedAt: entry.startedAt };
    }
    pid = entry.ppid;
  }
  return null;
}

export function readProcessTable() {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid=,tty=,lstart=,command="], {
      encoding: "utf8",
      timeout: 500,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return parseProcessTable(output);
  } catch {
    // Unknown is deliberately different from an empty process table. A failed
    // probe must never evict every session.
    return null;
  }
}

/* One row per process: pid, parent, controlling terminal, a fixed-width start
   time, and the command. The terminal is what tells two `claude` processes
   apart to a human — "ttys003" is the tab you can find — so it rides along
   with the liveness facts rather than costing a second probe. A process with
   no terminal shows `??` on macOS and `?` on Linux; both read as none. */
export function parseProcessTable(output) {
  return String(output || "").split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.*)$/.exec(line);
    if (!match) return [];
    const tty = match[3].replace(/^\/dev\//, "");
    return [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      tty: /^[?-]+$/.test(tty) ? null : tty,
      startedAt: match[4].trim(),
      command: match[5]
    }];
  });
}

/* Did this session tell us which process it belongs to? Only sessions that did
   can be proven alive, and only they are safe from the silence timeout. */
export function hasSessionIdentity(session) {
  return Number.isSafeInteger(session?.ownerPid) && session.ownerPid > 1;
}

/* The process a session says it belongs to, if the table has it. */
export function processEntryFor(pid, processes) {
  if (!Array.isArray(processes)) return null;
  return processes.find((entry) => entry.pid === Number(pid)) || null;
}

export function isSessionOwnerAlive(session, processes) {
  if (!hasSessionIdentity(session)) return null;
  if (!Array.isArray(processes)) return null;
  const current = processes.find((entry) => entry.pid === session.ownerPid);
  if (!current) return false;
  return !session.ownerStartedAt || current.startedAt === session.ownerStartedAt;
}
