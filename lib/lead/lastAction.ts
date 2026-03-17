/**
 * Helper pour garantir last_action { type, at, label } partout (draft, send, proposal, booked, slots, info).
 */

export type LastActionPayload = {
  type: string;
  label: string;
};

export type LastAction = {
  type: string;
  at: string;
  label: string;
};

export function setLastAction(
  leadJson: Record<string, unknown>,
  payload: LastActionPayload,
  nowIso: string
): LastAction {
  const action: LastAction = {
    type: payload.type,
    at: nowIso,
    label: payload.label,
  };
  return action;
}

/** Retourne l'objet à merger dans lead_json : { ...leadJson, last_action } */
export function mergeLastAction(
  leadJson: Record<string, unknown>,
  payload: LastActionPayload,
  nowIso: string
): { last_action: LastAction } {
  return {
    last_action: setLastAction(leadJson, payload, nowIso),
  };
}
