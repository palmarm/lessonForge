type Router = {
  pathname: () => string;
  replace: (href: string) => void;
};
type Entry = { href: string; state: History["state"] };

// Keep the committed workspace and browser URL together. Markers only describe
// entries we observed; native/unmarked entries must never imply a safe departure.
export function protectBrowserNavigation(
  allow: () => boolean,
  needsUnloadWarning: () => boolean,
  router: Router,
) {
  const navigation = (
    window as unknown as {
      navigation?: EventTarget & { currentEntry: { index: number } | null };
    }
  ).navigation;
  const indexKey = "__lessonforgeNavigationIndex";
  const push = history.pushState;
  const replace = history.replaceState;
  let chain = crypto.randomUUID();
  let index = 0;
  const entries = new Map<number, string>();
  let safe: Entry = { href: location.href, state: history.state };
  let rollingBack: Entry | null = null;
  let traversal: {
    href: string;
    allowed: boolean;
    distance: number | null;
  } | null = null;
  const marker = () => ({ chain, index });
  const position = (entry: Entry): number | null => {
    const value = entry.state?.[indexKey];
    return value?.chain === chain &&
      Number.isInteger(value.index) &&
      entries.get(value.index) === entry.href
      ? value.index
      : null;
  };
  const reset = () => {
    chain = crypto.randomUUID();
    index = 0;
    entries.clear();
  };
  const synchronize = () => {
    if (rollingBack || location.pathname !== router.pathname()) return;
    safe = { href: location.href, state: history.state };
  };
  const sameDocument = (a: URL, b: URL) =>
    a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const click = (event: MouseEvent) => {
    const anchor =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (
      !anchor ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      anchor.target === "_blank" ||
      anchor.hasAttribute("download")
    )
      return;
    const target = new URL(anchor.href, location.href);
    // Only a real in-page target in the committed document can avoid a leave
    // check. Navigation links still check the stores, even with the same path.
    let fragment: HTMLElement | null = null;
    try {
      fragment = target.hash
        ? document.getElementById(decodeURIComponent(target.hash.slice(1)))
        : null;
    } catch {
      /* An invalid fragment is not an in-page focus target. */
    }
    if (
      !rollingBack &&
      anchor.getAttribute("href")?.startsWith("#") &&
      fragment &&
      fragment.getClientRects().length > 0 &&
      location.href === safe.href &&
      target.pathname === router.pathname() &&
      sameDocument(target, new URL(safe.href))
    ) {
      stop(event);
      if (target.href !== location.href)
        history.pushState(history.state, "", target.href);
      synchronize();
      // Preserve native anchor scrolling/focus, including non-focusable headings.
      if (!fragment.hasAttribute("tabindex") && fragment.tabIndex < 0) {
        fragment.setAttribute("tabindex", "-1");
        fragment.addEventListener(
          "blur",
          () => fragment?.removeAttribute("tabindex"),
          { once: true },
        );
      }
      fragment.focus({ preventScroll: true });
      fragment.scrollIntoView();
      return;
    }
    if (rollingBack || !allow()) stop(event);
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (needsUnloadWarning()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  type NavigateEvent = Event & {
    navigationType: string;
    destination: { url: string; index: number; sameDocument: boolean };
  };
  const traverse = (event: Event) => {
    traversal = null;
    const navigate = event as NavigateEvent;
    if (navigate.navigationType !== "traverse" || rollingBack) return;
    const allowed = allow();
    if (!navigate.destination.sameDocument && event.cancelable && !allowed) {
      event.preventDefault();
      return;
    }
    const from = navigation?.currentEntry?.index;
    const to = navigate.destination.index;
    traversal = {
      href: navigate.destination.url,
      allowed,
      distance: from !== undefined && from >= 0 && to >= 0 ? from - to : null,
    };
    // For same-document traversals, keep the router suspended in popstate and
    // roll back using native positions. Canceling navigate can leave Chromium's
    // fragment Forward cursor unable to traverse again after a canceled Forward.
  };
  const guardedPush: History["pushState"] = function (data, unused, url) {
    // An unmanaged insertion breaks our knowledge of relative positions.
    if (position({ href: location.href, state: history.state }) === null)
      reset();
    for (const key of entries.keys()) if (key > index) entries.delete(key);
    index++;
    push.call(history, { ...data, [indexKey]: marker() }, unused, url);
    entries.set(index, location.href);
  };
  const guardedReplace: History["replaceState"] = function (data, unused, url) {
    replace.call(history, { ...data, [indexKey]: marker() }, unused, url);
    entries.set(index, location.href);
  };
  const restoreSafe = (entry: Entry) => {
    // Without a known position, go(n) could leave the editor again or do nothing.
    // Replace that destination with the safe entry and invalidate old distances.
    reset();
    replace.call(
      history,
      { ...entry.state, [indexKey]: marker() },
      "",
      entry.href,
    );
    entries.set(index, entry.href);
    safe = { href: entry.href, state: history.state };
    rollingBack = null;
  };
  const pop = (event: PopStateEvent) => {
    if (rollingBack) {
      event.stopImmediatePropagation();
      const entry = rollingBack;
      rollingBack = null;
      if (
        location.href !== entry.href ||
        position({ href: location.href, state: event.state }) !==
          position(entry)
      )
        restoreSafe(entry);
      return;
    }
    const destination = { href: location.href, state: event.state };
    const next = position(destination);
    const previous = position(safe);
    const decision = traversal?.href === destination.href ? traversal : null;
    traversal = null;
    // Always consult the live stores, including equal/absent/foreign markers.
    // The Navigation API already checked this exact traversal before it started.
    if (!(decision ? decision.allowed : allow())) {
      event.stopImmediatePropagation();
      const distance =
        decision?.distance ??
        (next !== null && previous !== null ? previous - next : 0);
      if (distance) {
        rollingBack = safe;
        history.go(distance);
      } else restoreSafe(safe);
    } else if (next === null || !event.state?.__NA) {
      event.stopImmediatePropagation();
      reset();
      // Unknown entries may lack Next's route tree. Repair through the router;
      // merely adopting their URL/state can leave the old page rendered.
      replace.call(
        history,
        { ...safe.state, [indexKey]: marker() },
        "",
        destination.href,
      );
      entries.set(index, destination.href);
      if (sameDocument(new URL(safe.href), new URL(destination.href)))
        synchronize();
      router.replace(destination.href);
    } else {
      index = next;
      synchronize();
    }
  };
  document.addEventListener("click", click, true);
  window.addEventListener("beforeunload", unload);
  navigation?.addEventListener("navigate", traverse);
  replace.call(history, { ...history.state, [indexKey]: marker() }, "");
  entries.set(index, location.href);
  synchronize();
  history.pushState = guardedPush;
  history.replaceState = guardedReplace;
  window.addEventListener("popstate", pop, true);
  return {
    synchronize,
    dispose: () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
      navigation?.removeEventListener("navigate", traverse);
      window.removeEventListener("popstate", pop, true);
      if (history.pushState === guardedPush) history.pushState = push;
      if (history.replaceState === guardedReplace)
        history.replaceState = replace;
    },
  };
}
