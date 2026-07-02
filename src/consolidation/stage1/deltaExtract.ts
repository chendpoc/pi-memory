import { createHash } from "node:crypto";

import type { SessionTurn } from "../../trainer/sessionLoader.js";

function turnHash(turn: SessionTurn): string {
  return createHash("sha256")
    .update(`${turn.role}\0${turn.content}`)
    .digest("hex");
}

export function computeDeltaTurns(
  parentTurns: SessionTurn[],
  childTurns: SessionTurn[],
): SessionTurn[] {
  let forkIndex = 0;
  for (
    ;
    forkIndex < parentTurns.length && forkIndex < childTurns.length;
    forkIndex++
  ) {
    if (turnHash(parentTurns[forkIndex]!) !== turnHash(childTurns[forkIndex]!)) {
      break;
    }
  }
  return childTurns.slice(forkIndex).map((turn, idx) => ({
    ...turn,
    turnIndex: idx,
  }));
}
