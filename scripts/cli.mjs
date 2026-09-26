import { launch, diagnose, stopService, uninstallRuntime, openBrowser } from "./runtime.mjs";

export async function main(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const words = argv.filter(a => !a.startsWith('--'));
  const action = words[0] || "start";
  if (action === 'help' || argv.includes('-h') || flags.has('--help')) {
    console.log(`The Patch — a little workshop for your Claude Code sessions

  the-patch                 Set up, start, and open the map
  the-patch status          Check local service and Claude integration
  the-patch doctor          Diagnose setup without changing it
  the-patch repair          Refresh integration and reopen the map
  the-patch stop            Pause until you launch again
  the-patch uninstall       Remove integration; keep familiar history

  --no-open                 Print the local URL without opening a browser
  --no-statusline           Leave your terminal status line alone
  --wrap-statusline         Add familiar names to an existing status line
  --json                    Machine-readable status/doctor output

Run from any directory. No project setup is required.
macOS first; Linux/WSL beta. Node.js 22+ and Claude Code on PATH.
`);
    return;
  }
  const allowed = new Set(['--no-open', '--no-statusline', '--wrap-statusline', '--json']);
  for (const flag of flags) if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}. Run with --help.`);
  if (words.length > 1) throw new Error("No project path is needed. The Patch watches your Claude profile's local projects.");
  if (['status', 'doctor'].includes(action)) {
    const report = await diagnose();
    if (flags.has('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(report.health ? `The Patch is running at ${report.health.origin}` : "The Patch is not running.");
      if (report.claudeVersion) console.log(`Claude Code ${report.claudeVersion}`);
      if (report.health) console.log(report.health.delivery?.hookEvents ? "Receiving Claude Code activity." : "Ready; waiting for activity from Claude Code.");
      for (const problem of report.problems) console.log(`  ${problem}`);
    }
    if (report.problems.length) process.exitCode = 1;
    return;
  }
  if (action === 'stop') { await stopService(); console.log("The Patch is paused. Launch again to resume."); return; }
  // `connect` and `disconnect` are the prototype's names, kept as aliases.
  if (['uninstall', 'disconnect'].includes(action)) { await uninstallRuntime(); console.log("The Patch is uninstalled. Your familiar history was kept."); return; }
  if (!['start', 'open', 'connect', 'repair'].includes(action)) throw new Error(`Unknown command: ${action}. Run with --help.`);
  console.log("Getting your workshop ready…");
  const health = await launch({ statusLine: !flags.has('--no-statusline'), wrapStatusLine: flags.has('--wrap-statusline') });
  console.log(`\nThe Patch is ready at ${health.origin}\nWatching your Claude Code profile's local projects.\nYou can close this terminal.`);
  if (!flags.has('--no-open') && !await openBrowser(health.origin)) console.log(`Open ${health.origin} in your browser.`);
}
