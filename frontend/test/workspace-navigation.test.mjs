import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceNavigation } from "../src/lib/workspace-navigation.ts";

test("navigation reads current state and never confirms away an unresolved write", () => {
  const navigation = createWorkspaceNavigation();
  let state = { dirty: false, blocked: false, paused: false };
  const remove = navigation.register(() => state);
  assert.equal(
    navigation.allow(() => {
      throw Error("unnecessary prompt");
    }),
    true,
  );
  state = { ...state, dirty: true };
  assert.equal(
    navigation.allow(() => false),
    false,
  );
  assert.equal(
    navigation.allow(() => true),
    true,
  );
  assert.equal(
    navigation.snapshot().dirty,
    true,
    "navigation never saves/discards work",
  );
  state = { ...state, blocked: true };
  for (const signingOut of [false, true]) {
    assert.equal(
      navigation.allow(() => {
        throw Error("must not offer bypass");
      }, signingOut),
      false,
    );
  }
  state = { ...state, blocked: false, paused: true };
  assert.equal(
    navigation.allow(() => true),
    false,
  );
  assert.equal(
    navigation.allow(() => true, true),
    true,
    "explicit logout retry remains possible",
  );
  remove();
  assert.deepEqual(navigation.snapshot(), {
    dirty: false,
    blocked: false,
    paused: false,
  });
});

test("another mounted workspace can block leaving and disposal removes its protection", () => {
  const navigation = createWorkspaceNavigation();
  navigation.register(() => ({ dirty: false, blocked: false, paused: false }));
  const dispose = navigation.register(() => ({
    dirty: true,
    blocked: true,
    paused: false,
  }));
  assert.equal(
    navigation.allow(() => true),
    false,
  );
  dispose();
  assert.equal(
    navigation.allow(() => true),
    true,
  );
});

test("unresolved copy survives workspace navigation but warns before confirmed session loss", () => {
  const navigation = createWorkspaceNavigation();
  const remove = navigation.register(() => ({
    dirty: false,
    blocked: false,
    paused: false,
    unresolvedCopy: true,
  }));
  assert.equal(
    navigation.allow(() => {
      throw new Error("ordinary navigation needs no copy confirmation");
    }),
    true,
  );
  assert.equal(navigation.snapshot().unresolvedCopy, true);
  let message;
  assert.equal(
    navigation.allow((text) => {
      message = text;
      return false;
    }, true),
    false,
  );
  assert.match(message, /unresolved copy.*recovery key.*lost/);
  assert.equal(
    navigation.allow(() => true, true),
    true,
  );
  remove();
  assert.equal(navigation.snapshot().unresolvedCopy, undefined);
});
