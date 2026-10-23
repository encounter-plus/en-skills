import assert from "node:assert/strict";
import test from "node:test";
import {
  assessRisk,
  ConfirmationRequiredError,
  enforceRisk,
  OperationDeniedError,
} from "../src/policy.js";
import type { LiveContext } from "../src/types.js";

const context = (state: LiveContext["state"], currentCount = 0, passedCount = 0): LiveContext => ({
  state,
  currentCount,
  passedCount,
  checkedAt: "2030-01-01T00:00:00.000Z",
});

test("answer aliases and organizer messages are allowed in live games", () => {
  assert.equal(assessRisk("add-answer-alias", context("live", 5, 2)).action, "allow");
  assert.equal(assessRisk("post-message", context("live", 5, 2)).action, "allow");
});

test("task and hint edits require confirmation after a player reaches the level", () => {
  assert.throws(() => enforceRisk("update-task", context("live", 1), false), ConfirmationRequiredError);
  assert.throws(() => enforceRisk("update-hint", context("live", 0, 1), false), ConfirmationRequiredError);
  assert.equal(enforceRisk("update-hint", context("live", 0, 1), true).action, "confirm");
});

test("hint timing can change without extra confirmation before anyone reaches the level", () => {
  assert.equal(enforceRisk("update-hint", context("live"), false).action, "allow");
});

test("sector deletion is blocked with current players or unknown live state", () => {
  assert.throws(() => enforceRisk("delete-sector", context("live", 1), true), OperationDeniedError);
  assert.throws(() => enforceRisk("delete-sector", context("unknown"), true), OperationDeniedError);
});

test("dismiss and restore always require confirmation", () => {
  assert.throws(() => enforceRisk("dismiss-level", context("not-live"), false), ConfirmationRequiredError);
  assert.throws(() => enforceRisk("restore-level", context("not-live"), false), ConfirmationRequiredError);
});
