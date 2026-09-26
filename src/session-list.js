import { stateCopy } from "./state-language.js";
import { chosenSessionName, sessionTitle, whereLabel } from "./session-address.js";

export function orderedSessions(records, attentionOnly = false) {
  return [...records].filter((record) => !attentionOnly || record.controller.state === "needs_input")
    .sort((a, b) => {
      const rank = (r) => r.controller.state === "needs_input" ? 0 : r.controller.state === "trouble" ? 1 : 2;
      return rank(a) - rank(b) ||
        (Date.parse(a.trail[0]?.at || a.lastEventAt) || 0) - (Date.parse(b.trail[0]?.at || b.lastEventAt) || 0) ||
        a.key.localeCompare(b.key);
    });
}

/* Keep each button alive across events and clock updates. Reordering a keyed
   node can still disturb browser focus, so restore it if it remains present. */
export function updateSessionList(list, records, { selectedId, visibleKeys, portraits, onSelect, fallbackFocus }) {
  const focused = document.activeElement;
  const hadFocus = list.contains(focused);
  const existing = new Map([...list.children].map((node) => [node.dataset.key, node]));
  const shown = new Set(visibleKeys);
  records.forEach((record, index) => {
    let item = existing.get(record.key);
    if (!item) {
      item = document.createElement("li");
      item.dataset.key = record.key;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "session-choice";
      const portrait = document.createElement("span");
      portrait.className = "ins-portrait";
      portrait.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "session-choice-copy";
      copy.append(document.createElement("strong"), document.createElement("span"), document.createElement("small"));
      button.append(portrait, copy);
      button.addEventListener("click", () => onSelect(record.key));
      item.append(button);
    }
    existing.delete(record.key);
    const button = item.firstElementChild;
    const [portrait, copy] = button.children;
    const name = sessionTitle(record) || chosenSessionName(record);
    portrait.style.backgroundImage = `url("${portraits.get(record.familiarType) || ""}")`;
    copy.children[0].textContent = `${record.agentName}${name ? ` · ${name}` : ""}`;
    copy.children[1].textContent = `${stateCopy(record.controller.state).label}${shown.has(record.key) ? "" : " · Off map"}`;
    copy.children[2].textContent = whereLabel(record) || "Terminal not identified yet";
    button.setAttribute("aria-pressed", String(record.key === selectedId));
    if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
  });
  for (const node of existing.values()) node.remove();
  if (hadFocus && document.activeElement !== focused) {
    (focused.isConnected ? focused : list.querySelector("button") || fallbackFocus)?.focus({ preventScroll: true });
  }
}

/* Freshness text is deliberately excluded: only a changed selection/state or
   a changed attention set deserves an announcement. */
export function createSessionAnnouncer() {
  let previousWaiting = new Set();
  let previousSelection = "";
  return (records, selected) => {
    const waiting = orderedSessions(records, true);
    const ids = new Set(waiting.map((r) => r.key));
    const arrivals = waiting.filter((r) => !previousWaiting.has(r.key));
    const changed = ids.size !== previousWaiting.size || arrivals.length > 0;
    previousWaiting = ids;
    const signature = selected ? `${selected.key}:${selected.controller.state}:${Boolean(selected.leaving)}` : "";
    const selectionChanged = signature !== previousSelection;
    previousSelection = signature;
    const messages = [];
    if (arrivals.length) messages.push(`${arrivals.map((r) => `${r.agentName}${whereLabel(r) ? ` in ${whereLabel(r)}` : ""}`).join("; ")} ${arrivals.length === 1 ? "needs" : "need"} you.`);
    else if (changed) messages.push(waiting.length ? `${waiting.length} sessions still need you.` : "No sessions need your input.");
    if (selectionChanged && selected) messages.push(`${selected.agentName}. ${selected.leaving ? "Left the Patch" : stateCopy(selected.controller.state).label}. ${whereLabel(selected)}.`);
    return messages.join(" ");
  };
}
