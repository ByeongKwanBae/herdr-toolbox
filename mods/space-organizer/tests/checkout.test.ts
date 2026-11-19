import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedCheckout } from "../src/host/checkout.js";

test("ordinary repositories need no extra git process", async () => {
  assert.equal(await linkedCheckout("/repo", "/repo/.git", async () => assert.fail("unnecessary process")), false);
});
test("submodules and separate git directories never expose Remove worktree", async () => {
  for (const common of ["/parent/.git/modules/sub", "/separate.git", "/path\nwith-newline.git"]) {
    assert.equal(await linkedCheckout("/checkout", common, async () => ({ code: 0, stdout: `${common}\n` })), false);
  }
});
test("only a verified distinct git directory identifies a linked worktree", async () => {
  assert.equal(await linkedCheckout("/linked", "/repo/.git", async () => ({ code: 0, stdout: "/repo/.git/worktrees/linked\n" })), true);
  assert.equal(await linkedCheckout("/linked", "/repo/.git", async () => ({ code: 1, stdout: "" })), null);
  assert.equal(await linkedCheckout("/linked", "/repo/.git", async () => ({ code: 0, stdout: "" })), null);
  assert.equal(await linkedCheckout("/linked", "/repo/.git", async () => { throw new Error("offline"); }), null);
});
