import { api, settings, type Settings } from "./api";
import { siteFor, selectors, cardText, thread, identity } from "./adapters";
import { gta, possibleStorySpoiler } from "../shared/model";
import { resolveLocale, translate } from "./i18n";
const site = siteFor(location.hostname);
if (site) protect(site);
type CardState = {
  signature: string;
  key: string;
  decision: "pending" | "covered" | "visible";
  notice?: HTMLElement;
  revealed?: boolean;
};
function protect(site: NonNullable<ReturnType<typeof siteFor>>) {
  const selector = selectors[site],
    states = new WeakMap<Element, CardState>(),
    noticeOwners = new WeakMap<Node, Element>();
  let config: Settings | undefined,
    locale = resolveLocale("auto"),
    epoch = 0,
    href = location.href;
  const dirty = new Set<Element>();
  function translateNotice(notice: HTMLElement) {
    notice.lang = locale;
    notice.firstElementChild!.textContent = translate(locale, "spoilerNotice");
    notice.lastElementChild!.textContent = translate(locale, "showPost");
  }
  function removeNotice(card: Element, state = states.get(card)) {
    state?.notice?.remove();
    if (state) delete state.notice;
    card.removeAttribute("data-vi-covered");
  }
  function allow(card: Element, state: CardState) {
    state.decision = "visible";
    removeNotice(card, state);
    card.setAttribute("data-vi-checked", "");
  }
  function pause(card: Element) {
    card.querySelectorAll("video,audio").forEach((el) => (el as HTMLMediaElement).pause());
  }
  document.addEventListener(
    "play",
    (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return;
      const card = event.target.closest(selector);
      if (event.target.closest("[data-vi-covered]") || (card && states.get(card)?.decision === "pending"))
        event.target.pause();
    },
    true,
  );
  function cover(card: Element, state: CardState) {
    state.decision = "covered";
    card.setAttribute("data-vi-covered", "");
    card.setAttribute("data-vi-checked", "");
    pause(card);
    if (state.notice?.isConnected && state.notice.nextElementSibling === card) return;
    state.notice?.remove();
    const notice = document.createElement("div");
    notice.setAttribute("data-vi-notice", "");
    const label = document.createElement("span");
    const button = document.createElement("button");
    button.type = "button";
    function reveal() {
      const state = states.get(card);
      if (state?.notice !== notice || notice.nextElementSibling !== card) return;
      if (cardKey(card, cardText(card, selector), thread(card, site, selector)) !== state.key) {
        visit(card);
        return;
      }
      state.revealed = true;
      allow(card, state);
      const focusable =
        card.querySelector<HTMLElement>("a[href],button,[tabindex='0']") ?? (card as HTMLElement);
      if (focusable === card && !card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");
      focusable.focus({ preventScroll: true });
    }
    button.addEventListener("click", reveal);
    notice.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        reveal();
      }
    });
    notice.append(label, button);
    translateNotice(notice);
    state.notice = notice;
    noticeOwners.set(notice, card);
    card.before(notice);
  }
  function cardKey(card: Element, text: string, context: string) {
    return identity(card, site, selector, [text, context].join("\u001e"));
  }
  function visit(card: Element) {
    if (!card.isConnected) {
      removeNotice(card);
      return;
    }
    if (!config) return;
    const text = cardText(card, selector),
      context = thread(card, site, selector),
      key = cardKey(card, text, context);
    const signature = [epoch, key, text, context].join("\u001e"),
      previous = states.get(card);
    if (previous?.signature === signature) {
      if (previous.decision === "covered" && previous.notice?.nextElementSibling !== card)
        cover(card, previous);
      return;
    }
    const revealed = previous?.key === key && previous.revealed;
    const state: CardState = { signature, key, revealed, decision: "pending", notice: previous?.notice };
    states.set(card, state);
    if (config.disabled.includes(site) || revealed) {
      allow(card, state);
      return;
    }
    const related = gta(text) || gta(context),
      combined = config.mode === "combined";
    if ((related && config.mode !== "smart") || (combined && possibleStorySpoiler(text, context))) {
      cover(card, state);
      return;
    }
    if ((combined && !text) || (!combined && !related)) {
      allow(card, state);
      return;
    }
    // Keep the card private during inference without showing a speculative warning.
    card.removeAttribute("data-vi-checked");
    if (previous?.key !== key) removeNotice(card, state);
    pause(card);
    const fallback = !combined;
    const timeout = setTimeout(() => finish(fallback), 3000);
    function finish(hide: boolean) {
      clearTimeout(timeout);
      if (!card.isConnected || states.get(card) !== state || state.decision !== "pending") return;
      if (hide) cover(card, state);
      else allow(card, state);
    }
    api.runtime.sendMessage({ type: "classify", text, context, combined }).then(
      (reply: any) => finish(typeof reply?.hide === "boolean" ? reply.hide : fallback),
      () => finish(fallback),
    );
  }
  function all() {
    document.querySelectorAll(selector).forEach((card) => dirty.add(card));
    schedule();
  }
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const cards = Array.from(dirty);
      dirty.clear();
      const visible = cards.map((card) => ({
        card,
        visible: card.getBoundingClientRect().top < innerHeight && card.getBoundingClientRect().bottom >= 0,
      }));
      visible.sort((a, b) => Number(b.visible) - Number(a.visible)).forEach(({ card }) => visit(card));
    });
  }
  function collect(node: Node) {
    if (!(node instanceof Element) || node.hasAttribute("data-vi-notice")) return;
    if (node.matches(selector)) dirty.add(node);
    node.querySelectorAll(selector).forEach((c) => dirty.add(c));
  }
  new MutationObserver((records) => {
    if (location.href !== href) {
      href = location.href;
      all();
    }
    for (const m of records) {
      for (const node of m.removedNodes) {
        const owner = noticeOwners.get(node);
        const state = owner && states.get(owner);
        if (
          owner &&
          state?.decision === "covered" &&
          state.notice === node &&
          state.notice.nextElementSibling !== owner
        )
          dirty.add(owner);
      }
      if (
        m.type === "childList" &&
        [...m.addedNodes, ...m.removedNodes].every(
          (n) => n instanceof Element && n.hasAttribute("data-vi-notice"),
        )
      )
        continue;
      const el = m.target instanceof Element ? m.target : m.target.parentElement;
      if (el?.closest("[data-vi-notice]")) continue;
      const card = el?.closest(selector);
      if (card) {
        dirty.add(card);
        card.querySelectorAll(selector).forEach((c) => dirty.add(c));
      }
      if (m.type === "attributes" && el?.matches(selector)) dirty.add(el);
      m.addedNodes.forEach(collect);
      m.removedNodes.forEach(collect);
      if (
        el?.closest("ytd-watch-metadata,shreddit-post,article[data-testid=tweet]") &&
        /\/comments\/|\/watch|\/status\//.test(location.pathname)
      )
        all();
    }
    schedule();
  }).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      "aria-label",
      "aria-description",
      "aria-labelledby",
      "aria-describedby",
      "title",
      "alt",
      "src",
      "poster",
      "href",
      "post-title",
      "permalink",
      "thingid",
      "id",
      "data-id",
      "video-id",
      "comment-id",
      "data-fullname",
      "role",
      "data-testid",
      "subreddit-prefixed-name",
    ],
  });
  window.addEventListener("popstate", all);
  const nav = (window as any).navigation;
  nav?.addEventListener("currententrychange", all);
  function applySettings(next: Settings) {
    const previous = config;
    config = next;
    const nextLocale = resolveLocale(next.language);
    if (locale !== nextLocale) {
      locale = nextLocale;
      document.querySelectorAll<HTMLElement>("[data-vi-notice]").forEach((notice) => {
        if (noticeOwners.has(notice)) translateNotice(notice);
      });
    }
    return !previous || previous.mode !== next.mode ||
      previous.disabled.includes(site) !== next.disabled.includes(site);
  }
  api.storage.onChanged.addListener((changes: any, area: string) => {
    if (area !== "local") return;
    const protectionChanged = changes.settings && applySettings(settings(changes.settings.newValue));
    if (protectionChanged || changes.catalogVersion) {
      epoch++;
      all();
    }
  });
  function initialize(value?: Partial<Settings>) {
    if (config) return;
    applySettings(settings(value));
    all();
  }
  api.storage.local.get("settings").then(
    (v: any) => initialize(v.settings),
    () => initialize(),
  );
}
