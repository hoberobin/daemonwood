import test from "node:test";
import assert from "node:assert/strict";
import { chosenSessionName, knownProject, whereLabel } from "../src/session-address.js";

/* The map's end of the terminal link. Every place the page points somewhere
   reads its address from here, so these are the words the user will go
   looking for a window with. */
test("the address is the terminal first and the project second, in a person's words", () => {
  const session = { terminalProgram: "VS Code", terminalTty: "ttys003", repository: "web-app" };
  assert.equal(whereLabel(session), "VS Code ttys003 · web-app");
});

test("a session the bridge could only partly place gets the parts it has, never a placeholder", () => {
  assert.equal(whereLabel({ terminalTty: "ttys003" }), "ttys003");
  assert.equal(whereLabel({ terminalProgram: "iTerm", repository: "web-app" }), "iTerm · web-app");
  assert.equal(whereLabel({ repository: "unlabeled-repo" }), "");
  assert.equal(whereLabel({}), "");
  assert.equal(whereLabel(null), "");
  assert.equal(knownProject({ repository: "unlabeled-repo" }), "");
});

/* Claude Code names every session. The fallback slug — the project plus two
   random characters — is the project row again with noise on the end, and
   Claude Code's own session list hides it too. A name a person or an agent
   chose is the only kind worth a row. */
test("only a chosen session name is shown; the fallback slug is not a fact worth a row", () => {
  assert.equal(chosenSessionName({ sessionName: "growth-report", sessionNameSource: "user" }), "growth-report");
  assert.equal(chosenSessionName({ sessionName: "fix-login-flow", sessionNameSource: "auto" }), "fix-login-flow");
  assert.equal(chosenSessionName({ sessionName: "web-app-6c", sessionNameSource: "derived" }), "");
  assert.equal(chosenSessionName({ sessionName: "web-app-6c-2", sessionNameSource: "collision" }), "");
  // An older bridge does not say how the name came about; the name stays.
  assert.equal(chosenSessionName({ sessionName: "web-app-6c" }), "web-app-6c");
  assert.equal(chosenSessionName({ sessionName: null, sessionNameSource: "user" }), "");
});
