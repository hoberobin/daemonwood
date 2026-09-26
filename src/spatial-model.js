const fixedStations = Object.freeze({
  workbench: { label: "Workbench", meaning: "Preparing or editing" },
  research: { label: "Research Desk", meaning: "Reading and searching" },
  command: { label: "Command Console", meaning: "Running commands or reporting trouble" },
  test_dungeon: { label: "Test Dungeon", meaning: "Running checks" },
  permission_gate: { label: "Permission Gate", meaning: "Waiting for your input" },
  shipping_dock: { label: "Shipping Dock", meaning: "Stopped working; the turn is yours" },
  campfire: { label: "Campfire", meaning: "Quiet for a while; open and unused" },
  exit: { label: "the gate", meaning: "On the way out" }
});

export function stationDetails(node, state) {
  return fixedStations[node] || { label: "Workshop path", meaning: "Traveling between stations" };
}

export function agentLocation(controller) {
  const station = stationDetails(controller.destination, controller.state);
  return {
    ...station,
    label: controller.moving ? "Heading to " + station.label : station.label,
    arrived: !controller.moving
  };
}

export const stationCatalog = fixedStations;
