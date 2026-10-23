import type { LiveContext, RiskDecision, RiskOperation } from "./types.js";

export class ConfirmationRequiredError extends Error {
  readonly code = "CONFIRMATION_REQUIRED";
  constructor(readonly details: unknown) {
    super("The operation requires confirmation for the current live-game risk");
    this.name = "ConfirmationRequiredError";
  }
}

export class OperationDeniedError extends Error {
  readonly code = "OPERATION_DENIED";
  constructor(readonly details: unknown) {
    super("The operation is blocked by the live-game safety policy");
    this.name = "OperationDeniedError";
  }
}

export function assessRisk(operation: RiskOperation, live: LiveContext): RiskDecision {
  if(operation==='write-level-content')return {action:'confirm',reason:'Review the exact level, content and settings. The confirmed import authorizes this step; preserve a snapshot and reconcile uncertain outcomes. Player state: '+live.state};
  if(['create-level','delete-level','copy-level'].includes(operation))return {action:'confirm',reason:'Review the selected game, exact persistent level ID, count and order. Deletion removes all level contents; native copying requires separate content review. A snapshot and explicit confirmation are required. Player state: '+live.state};
  if(operation==='move-answer')return {action:'confirm',reason:'Delete the exact original answer first, then recreate its literal code and native recipient in the destination sector with a new ID. This is sequential and non-atomic; source deletion can remain after an incomplete or uncertain creation. Review both inventory snapshots. Current player state: '+live.state};
  if (operation === "add-answer-alias" || operation === "post-message") {
    return { action: "allow", reason: "This operation preserves the already published game state" };
  }

  if (operation === "dismiss-level" || operation === "restore-level") {
    return { action: "confirm", reason: "Changing level availability affects every player and requires a snapshot" };
  }

  if (operation === "delete-sector") {
    if (live.state === "unknown") {
      return { action: "deny", reason: "Live state is unknown; sector deletion fails closed" };
    }
    if (live.state === "live" && live.currentCount > 0) {
      return { action: "deny", reason: "A sector must not be deleted while players are on the level" };
    }
    return { action: "confirm", reason: "Deleting a sector also removes its linked answers" };
  }

  if (live.state === "unknown") {
    return { action: "confirm", reason: "Live state could not be verified" };
  }
  if (live.state === "live" && (live.currentCount > 0 || live.passedCount > 0)) {
    return {
      action: "confirm",
      reason: `The level has ${live.currentCount} current and ${live.passedCount} passed players`,
    };
  }
  return { action: "allow", reason: "No players are known to have reached this level" };
}

export function enforceRisk(operation: RiskOperation, live: LiveContext, confirmed: boolean): RiskDecision {
  const decision = assessRisk(operation, live);
  const details = { operation, decision, live };
  if (decision.action === "deny") throw new OperationDeniedError(details);
  if (decision.action === "confirm" && !confirmed) throw new ConfirmationRequiredError(details);
  return decision;
}

/** Native legacy deletion has its own explicit scope approval; no fabricated live evidence. */
export function enforceLegacySectorDeletion(live:LiveContext,confirmed:boolean):RiskDecision {
  const decision:RiskDecision={action:'confirm',reason:'Native sector deletion removes the exact sector and its linked codes. Review the complete sector/code snapshot. '+(live.state==='unknown'?'Current player state is unknown.':`Observed player state: ${live.currentCount} current, ${live.passedCount} passed (${live.state}).`)};
  if(!confirmed)throw new ConfirmationRequiredError({operation:'delete-sector',decision,live});
  return decision;
}
