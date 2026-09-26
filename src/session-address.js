/* Where a session lives, said the way a person would look for it.

   The map and the terminal are two ends of one link, and the terminal end
   already says its part: the status line prints the familiar's name in the
   window it belongs to. This module is the map's end. Every place the page
   points you somewhere — the alert in the top bar, the next step under a
   waiting familiar — reads the address
   from here, so "which terminal is that?" has one answer in one wording.

   The address is the terminal first and the project second: the terminal is
   the part you can check (`tty` in the window you are wondering about) and
   the project is the part you recognise. Nothing here is invented: a session
   the bridge could not place gets the parts it has, and a session it could
   not place at all gets nothing rather than a placeholder. */

/* "VS Code ttys003 · web-app": the sentence-sized address for an alert or a
   next step, where it reads as a place — "in VS Code, ttys003". */
export function whereLabel(session) {
  const terminal = [session?.terminalProgram, session?.terminalTty].filter(Boolean).join(" ");
  const project = knownProject(session);
  return [terminal, project].filter(Boolean).join(" · ");
}

/* The project, or nothing. The sanitizer's placeholder is not a project. */
export function knownProject(session) {
  const repository = session?.repository;
  return repository && repository !== "unlabeled-repo" ? repository : "";
}

/* Claude Code names every session, and says how in the note: `user` for
   `/rename`, `auto` for a name it wrote itself, `hook` and `peer` for names
   handed in from outside, and `derived` or `collision` for the fallback — the
   project's slug plus two random characters, or that plus a number when two
   sessions share a project. The fallback kinds are a near copy of the
   project row with noise on the end, and a row that makes you work out that
   it means nothing is worse than no row; Claude Code's own session list
   drops them too. Everything else is a name somebody or something chose to
   say what the session is for, and stays. A note that did not say is given
   the benefit of the doubt, because older bridges did not pass the source. */
const madeUpNames = new Set(["derived", "collision"]);

export function chosenSessionName(session) {
  if (!session?.sessionName) return "";
  if (madeUpNames.has(session.sessionNameSource)) return "";
  return session.sessionName;
}

/* What the session is about, in the words on its terminal tab — Claude Code's
   generated title, or the /rename that replaced it. The hook reads it and
   sends it as the task label; the sanitizer's placeholder is not a title. */
export function sessionTitle(session) {
  const label = session?.taskLabel;
  return label && label !== "Unlabeled task" ? label : "";
}
