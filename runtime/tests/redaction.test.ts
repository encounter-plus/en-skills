import assert from "node:assert/strict";
import test from "node:test";
import { redactText, redactValue } from "../src/redaction.js";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJBdXRob3IxIn0.signature_value_123";

test("redacts bearer tokens and JWT-looking strings", () => {
  assert.equal(redactText(`Bearer ${jwt}`), "Bearer [REDACTED]");
  assert.equal(redactText(`token=${jwt}`), "token=[REDACTED_JWT]");
});

test("redacts secret-shaped object keys recursively", () => {
  assert.deepEqual(redactValue({ login: "Author1", password: "p", nested: { access_token: jwt } }), {
    login: "Author1",
    password: "[REDACTED]",
    nested: { access_token: "[REDACTED]" },
  });
});
