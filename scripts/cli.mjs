import { launch, diagnose, stopService, uninstallRuntime, openBrowser, commandFor } from "./runtime.mjs";

/* Verbs people type, mapped to what they do. `wake` is the documented front
   door ("npx daemonwood wake", and "wake up" reads naturally too); `sleep`
   is its pair. The older names stay as aliases so no instruction goes stale. */
const VERBS = {
  wake: "wake", start: "wake", open: "wake", connect: "wake",
  repair: "repair",
  status: "status", doctor: "doctor",
  sleep: "sleep", stop: "sleep",
  uninstall: "uninstall", disconnect: "uninstall"
};

export async function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  let words = argv.filter(a => !a.startsWith('--'));
  if (words[0] === 'wake' && words[1] === 'up') words = ['wake', ...words.slice(2)];
  const typed = words[0] || "wake";
  if (typed === 'help' || argv.includes('-h') || flags.has('--help')) {
    console.log(`Daemonwood — a little workshop for your Claude Code sessions

  ${commandFor('wake').padEnd(26)} Set up, start, and open the map
  ${commandFor('status').padEnd(26)} Check the service and Claude Code hooks
  ${commandFor('repair').padEnd(26)} Rewrite the hooks and restart
  ${commandFor('sleep').padEnd(26)} Pause until you wake it again
  ${commandFor('uninstall').padEnd(26)} Remove hooks and runtime; keep familiar names

  --no-open                  Print the local URL without opening a browser
  --no-statusline            Leave your terminal status line alone
  --wrap-statusline          Add familiar names to an existing status line
  --json                     Machine-readable status/doctor output

Run from any directory. No project setup is required.
macOS first; Linux/WSL beta. Node.js 22+ and Claude Code on PATH.
`);
    return;
  }
  const allowed = new Set(['--no-open', '--no-statusline', '--wrap-statusline', '--json']);
  for (const flag of flags) if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}. Run with --help.`);
  const action = VERBS[typed];
  if (!action) throw new Error(`Unknown command: ${typed}. Run with --help.`);
  if (words.length > 1) throw new Error("No project path is needed. Daemonwood watches your Claude profile's local projects.");
  if (['status', 'doctor'].includes(action)) {
    const report = await diagnose();
    if (flags.has('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(report.health ? `Daemonwood is awake at ${report.health.origin}` : "Daemonwood is not running.");
      if (report.claudeVersion) console.log(`Claude Code ${report.claudeVersion}`);
      if (report.health) console.log(report.health.delivery?.hookEvents ? "Receiving Claude Code activity." : "Ready; waiting for activity from Claude Code.");
      for (const problem of report.problems) console.log(`  ${problem}`);
    }
    if (report.problems.length) process.exitCode = 1;
    return;
  }
  if (action === 'sleep') { await stopService(); console.log(`Daemonwood is asleep. ${commandFor('wake')} wakes it.`); return; }
  if (action === 'uninstall') { await uninstallRuntime(); console.log("Daemonwood is uninstalled. Your familiar names were kept."); return; }
  console.log("Waking Daemonwood…");
  const health = await launch({ statusLine: !flags.has('--no-statusline'), wrapStatusLine: flags.has('--wrap-statusline') });
  console.log(`
Daemonwood is awake at ${health.origin}
Watching every Claude Code session in this profile. Open sessions appear now;
new ones report each move as it happens. You can close this terminal.

  Check it:  ${commandFor('status')}
  Pause it:  ${commandFor('sleep')}`);
  if (!flags.has('--no-open') && !await openBrowser(health.origin)) console.log(`\nOpen ${health.origin} in your browser.`);
}
