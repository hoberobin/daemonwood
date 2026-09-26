/* Configuration, discovery and delivery are different facts. A quiet session
   does not expire, and installed hooks never stand in for delivered events. */
export function connectionStatus({ setup = null, delivery = null, bridge = "connecting", sessions = 0 } = {}) {
  const hooks = setup?.hooks;
  const installed = Boolean(hooks?.total > 0 && hooks.configured === hooks.total);
  const received = Boolean(delivery?.hookEvents > 0 && delivery?.lastHookReceivedAt);
  const live = bridge === "live";
  // A problem the person must fix outranks every reassurance. No hooks at all
  // may be a project-scoped install this check cannot see, so only a partial
  // set counts as broken.
  const problem = live && (setup?.blocked ? "blocked" : setup?.error ? "unreadable" : hooks?.configured > 0 && !installed ? "incomplete" : null);
  const label = !live ? (bridge === "connecting" ? "Connecting to bridge" : "Reconnecting…")
    : problem === "blocked" ? "Claude Code hooks are disabled"
    : problem ? "Daemonwood needs a quick repair"
    : received ? "Receiving Claude events"
    : installed ? "Ready for Claude Code"
    : sessions ? "Claude sessions detected" : "Connect Claude Code";
  const short = !live ? (bridge === "connecting" ? "Connecting" : "Offline")
    : problem === "blocked" ? "Blocked" : problem ? "Repair"
    : received ? "Receiving" : installed ? "Ready" : sessions ? "Detected" : "Connect";
  const details = [live ? "Local bridge is responding." : "Live updates are unavailable; shown states may be out of date."];
  if (setup?.blocked) details.push("Your Claude Code user settings disable all hooks (disableAllHooks), so no activity can reach the map.");
  if (setup?.error) details.push(setup.error);
  if (hooks) {
    details.push(`${hooks.configured} of ${hooks.total} hooks installed in ${setup.file || "user settings"}. This check covers user-wide settings; project-local settings are not checked here.`);
  } else if (!setup?.error) details.push("Hook installation has not been checked.");
  if (received) {
    details.push(`${delivery.hookEvents} hook events received by this bridge since it started. Last received ${new Date(delivery.lastHookReceivedAt).toLocaleTimeString()}. This confirms delivery, not coverage of every session.`);
  } else details.push("No hook events received by this bridge since it started. Sessions may still appear from Claude Code's local session notes.");
  if (setup?.statusLine) details.push(setup.statusLine.active
    ? "The familiar status-line wrapper is installed."
    : "The familiar status-line wrapper is not installed.");
  // Settled: nothing for the person to do, so the corner button can step aside.
  return { label, short, problem, active: live && received && !problem, settled: live && !problem && (installed || received), details: details.join(" ") };
}
