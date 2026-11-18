import { api, settings, type Settings } from "./api";
import { siteFor, selectors, uncheckedCards, cardText, thread, publicationId, contentIdentity, hasCaption } from "./adapters";
import { gta, mayMentionParticipant, possibleStorySpoiler } from "../shared/model";
import { resolveLocale, translate } from "./i18n";
const site = siteFor(location.hostname);
if (site) protect(site);
type CardState = {
  signature: string;
  key: string;
  publication?: string;
  decision: "pending" | "covered" | "visible";
  notice?: HTMLElement;
  revealed?: boolean;
};
function protect(site: NonNullable<ReturnType<typeof siteFor>>) {
  const selector = selectors[site],
    blockedMedia = `${uncheckedCards(selector)},[data-vi-covered]`,
    states = new WeakMap<Element, CardState>(),
    firstChecks = new WeakMap<Element, { ready: boolean }>(),
    noticeOwners = new WeakMap<Node, Element>();
  // Virtual feeds remount posts into fresh elements. Only confirmed automatic
  // decisions are reusable, and only with the same publication and classifier inputs.
  const decisions = new Map<string, { signature: string; hide: boolean }>();
  let config: Settings | undefined,
    participantTokens: Set<string> | undefined,
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
    if (!card.hasAttribute("data-vi-checked")) card.setAttribute("data-vi-checked", "");
  }
  function pause(card: Element) {
    card.querySelectorAll("video,audio").forEach((el) => (el as HTMLMediaElement).pause());
  }
  document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof HTMLMediaElement && event.target.closest(blockedMedia))
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
      const key = publicationId(card, site, selector) ??
        contentIdentity(card, selector, cardText(card, selector) + "\u001e" + thread(card, site, selector));
      if (key !== state.key) {
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
  function waitingForFirstContent(card: Element) {
    const check = firstChecks.get(card);
    if (check) return !check.ready;
    // The feed can insert a preview and supply its caption in a later frame.
    const gate = { ready: false };
    firstChecks.set(card, gate);
    setTimeout(() => {
      if (firstChecks.get(card) !== gate) return;
      gate.ready = true;
      if (card.isConnected) {
        dirty.add(card);
        schedule();
      }
    }, 180);
    return true;
  }
  function visit(card: Element) {
    if (!card.isConnected) {
      removeNotice(card);
      if (states.get(card)?.decision === "pending") states.delete(card);
      return;
    }
    if (!config) return;
    const text = cardText(card, selector),
      context = thread(card, site, selector),
      publication = publicationId(card, site, selector),
      key = publication ?? contentIdentity(card, selector, text + "\u001e" + context);
    const signature = JSON.stringify([epoch, text, context]),
      previous = states.get(card);
    const replaced = previous?.publication !== undefined && publication !== undefined && previous.publication !== publication;
    // Media sources can change while a card plays or lazy-loads. Only a manual
    // reveal depends on identity when the text and classification inputs match.
    if (!replaced && previous?.signature === signature && (previous.key === key || !previous.revealed)) {
      previous.key = key;
      previous.publication = publication;
      if (previous.decision === "covered" && previous.notice?.nextElementSibling !== card)
        cover(card, previous);
      return;
    }
    const revealed = previous?.key === key && previous.revealed;
    const bypass = config.disabled.includes(site) || revealed;
    const related = !bypass && (gta(text) || gta(context));
    const combined = config.mode === "combined";
    const hideNow = (related && config.mode !== "smart") ||
      (combined && !bypass && possibleStorySpoiler(text, context));
    const cached = publication ? decisions.get(publication) : undefined;
    const reuse = cached?.signature === signature;
    if (replaced) firstChecks.delete(card);
    if ((!previous || replaced) && !reuse && !bypass && !hideNow && !hasCaption(card, site) && waitingForFirstContent(card)) {
      removeNotice(card);
      states.delete(card);
      card.removeAttribute("data-vi-checked");
      pause(card);
      return;
    }
    const state: CardState = { signature, key, publication, revealed, decision: "pending", notice: previous?.notice };
    states.set(card, state);
    function decide(hide: boolean, remember: boolean) {
      if (remember && publication) {
        decisions.delete(publication);
        decisions.set(publication, { signature, hide });
        if (decisions.size > 256) decisions.delete(decisions.keys().next().value!);
      }
      if (hide) cover(card, state);
      else allow(card, state);
    }
    if (bypass) {
      allow(card, state);
      return;
    }
    if (reuse) {
      decide(cached.hide, false);
      return;
    }
    if (hideNow || (combined && !text) || (!combined && !related) ||
        (participantTokens && !mayMentionParticipant(text, context, participantTokens))) {
      decide(hideNow, true);
      return;
    }
    // Keep the card private during inference without showing a speculative warning.
    card.removeAttribute("data-vi-checked");
    if (previous?.key !== key) removeNotice(card, state);
    pause(card);
    const fallback = !combined;
    const timeout = setTimeout(() => finish(), 3000);
    function finish(hide?: boolean) {
      clearTimeout(timeout);
      if (!card.isConnected || states.get(card) !== state || state.decision !== "pending") return;
      decide(hide ?? fallback, hide !== undefined);
    }
    api.runtime.sendMessage({ type: "classify", text, context, combined }).then(
      (reply: any) => finish(typeof reply?.hide === "boolean" ? reply.hide : undefined),
      () => finish(),
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
    function queue(card: Element) {
      // Sites can clone a card along with the extension's attributes.
      if (!states.has(card)) {
        card.removeAttribute("data-vi-checked");
        card.removeAttribute("data-vi-covered");
      }
      dirty.add(card);
    }
    if (node.matches(selector)) queue(node);
    node.querySelectorAll(selector).forEach(queue);
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
  function refreshParticipantTokens() {
    participantTokens = undefined;
    if (!config || config.mode === "preventive" || config.disabled.includes(site)) return;
    const generation = epoch;
    api.runtime.sendMessage({ type: "participantTokens" }).then((tokens: unknown) => {
      if (epoch === generation && Array.isArray(tokens) && tokens.every(t => typeof t === "string"))
        participantTokens = new Set(tokens);
    }, () => {});
  }
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
      decisions.clear();
      refreshParticipantTokens();
      all();
    }
  });
  function initialize(value?: Partial<Settings>) {
    if (config) return;
    applySettings(settings(value));
    refreshParticipantTokens();
    all();
  }
  api.storage.local.get("settings").then(
    (v: any) => initialize(v.settings),
    () => initialize(),
  );
}
