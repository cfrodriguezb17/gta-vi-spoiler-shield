import type { Site } from "./api";
const youtubeVideoCards = "ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer";
const youtubeShortCards = [
  "ytd-reel-item-renderer",
  "ytm-reel-item-renderer",
  "ytd-reel-video-renderer",
  "yt-shorts-lockup-view-model",
  "yt-shorts-lockup-view-model-v2",
  "ytm-shorts-lockup-view-model",
  "ytm-shorts-lockup-view-model-v2",
].join(",");
const controls = [
  "time,[role=timer],[role=slider],[role=progressbar],[role=tooltip],progress,input[type=range]",
  "shreddit-post-action-row,shreddit-comment-action-row,shreddit-player-controls",
  "[data-testid=videoPlayer],[role=group]:has([data-testid=reply]):has([data-testid=like],[data-testid=unlike])",
  "[data-testid=like],[data-testid=unlike],[data-testid=retweet],[data-testid=unretweet],a[href$='/analytics']",
  "ytd-menu-renderer,yt-button-shape,yt-icon-button,tp-yt-paper-tooltip,ytd-thumbnail-overlay-time-status-renderer",
  "ytd-thumbnail-overlay-toggle-button-renderer,ytd-thumbnail-overlay-hover-text-renderer,ytd-thumbnail-overlay-now-playing-renderer",
  "yt-thumbnail-overlay-badge-view-model,yt-thumbnail-hover-overlay-toggle-actions-view-model",
  ".html5-video-player,ytd-shorts-player-controls,desktop-shorts-player-controls",
].join(",");
export const selectors: Record<Site, string> = {
  reddit:
    "shreddit-post,shreddit-comment,.thing.link,.thing.comment,[data-testid=post-container],[data-testid=comment]",
  youtube: [
    youtubeVideoCards,
    `yt-lockup-view-model:not(:is(${youtubeVideoCards},${youtubeShortCards}) *)`,
    `:is(${youtubeShortCards}):not(:is(${youtubeVideoCards},${youtubeShortCards},yt-lockup-view-model) *)`,
    "ytd-comment-view-model,ytd-comment-renderer,ytm-video-with-context-renderer,ytd-watch-metadata",
  ].join(","),
  x: "article[data-testid=tweet],[data-testid=cellInnerDiv] [role=article]",
  facebook: "[role=article],[data-pagelet^=FeedUnit_],div[aria-posinset][aria-describedby]",
  instagram:
    "article,[role=dialog] ul li,main a[href^='/p/']:not(article a),main a[href^='/reel/']:not(article a)",
};
export function uncheckedCards(selector: string) {
  return `:is(${selector}):not([data-vi-checked])`;
}
const captions: Record<Site, string> = {
  reddit: "[slot=title],[slot=text-body],.usertext-body,a.title",
  youtube: "#video-title,#video-title-link,.yt-lockup-metadata-view-model__title,h1,h3,#content-text",
  x: "[data-testid=tweetText]",
  facebook: "[data-ad-preview=message],[data-ad-comet-preview=message]",
  instagram: "h1,[role=heading]",
};
export function hasCaption(card: Element, site: Site) {
  if (site === "reddit" && card.getAttribute("post-title")?.trim()) return true;
  return Array.from(card.querySelectorAll(captions[site])).some(el =>
    el.closest(selectors[site]) === card && !!el.textContent?.trim());
}
export function siteFor(host: string): Site | undefined {
  const domains: Record<Site, string[]> = {
    reddit: ["reddit.com"],
    youtube: ["youtube.com"],
    x: ["x.com", "twitter.com"],
    facebook: ["facebook.com"],
    instagram: ["instagram.com"],
  };
  return (Object.keys(domains) as Site[]).find((site) =>
    domains[site].some((d) => host === d || host.endsWith("." + d)),
  );
}
const relativeTime = /^(?:\d+[smhdw]|(?:hace\s+)?\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|segundos?|minutos?|horas?|días?|semanas?)(?:\s+ago)?)$/i;
const counter = /^\d[\d.,\s]*(?:(?:k|m|mil|million|millones?)\s*)?(?:(?:views?|likes?|replies|comments?|shares?|reposts?|vistas?|visualizaciones|me gusta|respuestas?|comentarios?|veces compartido))?$/i;
const metadata = "button,[role=button],#metadata-line,yt-content-metadata-view-model,.yt-content-metadata-view-model__metadata-row";
export function cardText(card: Element, selector: string) {
  const parts = new Set<string>();
  const referenced = new Set<Element>();
  function add(value: string | null, owner: Element | null) {
    const part = value?.trim().replace(/\s+/g, " ");
    if (!part) return;
    if ((counter.test(part) || relativeTime.test(part)) && owner?.closest(metadata + ",a:has(time)")) return;
    parts.add(part);
  }
  const visit = (node: Node, readReferences = true) => {
    if (node instanceof Text) {
      add(node.textContent, node.parentElement);
      return;
    }
    if (
      !(node instanceof Element) ||
      node.matches("script,style,template,[data-vi-notice]," + controls) ||
      (node !== card && node.matches(selector))
    )
      return;
    for (const attr of [
      "aria-label",
      "aria-description",
      "alt",
      "title",
      "post-title",
      "subreddit-prefixed-name",
    ]) {
      add(node.getAttribute(attr), node);
    }
    if (readReferences) {
      for (const attr of ["aria-labelledby", "aria-describedby"]) {
        for (const id of (node.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
          const label = document.getElementById(id);
          if (label && !referenced.has(label) && !label.closest(controls) && !label.contains(node)) {
            referenced.add(label);
            visit(label, false);
          }
        }
      }
    }
    for (const child of node.childNodes) visit(child, readReferences);
  };
  visit(card);
  return [...parts].join(" ").slice(0, 12000);
}
export function publicationId(card: Element, site: Site, selector: string) {
  const route = location.pathname + location.search;
  if (site === "youtube" && card.matches("ytd-watch-metadata") && location.pathname === "/watch")
    return JSON.stringify([route, "watch"]);
  const ids = ["thingid", "data-fullname", "video-id", "comment-id", "permalink"].map((attr) =>
    card.getAttribute(attr),
  );
  if (ids.some(Boolean)) return JSON.stringify([route, "id", ...ids]);
  const linkSelectors: Record<Site, string> = {
    reddit: "a[href*='/comments/']",
    youtube: "a[href*='watch?v='],a[href*='/shorts/']",
    x: "a[href*='/status/']:has(time)",
    facebook: "a[href*='/posts/'],a[href*='story_fbid=']",
    instagram: "a[href^='/p/'],a[href^='/reel/']",
  };
  // Links inside comments can point to the thread or another post.
  if (!card.matches("shreddit-comment,.thing.comment,[data-testid=comment],ytd-comment-view-model,ytd-comment-renderer,li")) {
    const link = linkSelectors[site];
    const ref = card instanceof HTMLAnchorElement && card.matches(link)
      ? card
      : Array.from(card.querySelectorAll<HTMLAnchorElement>(link)).find((a) => a.closest(selector) === card);
    if (ref && siteFor(ref.hostname) === site) {
      const params = new URLSearchParams(ref.search);
      return JSON.stringify([route, "link", ref.pathname, params.get("v"), params.get("story_fbid")]);
    }
  }
}
// Only a manual reveal needs a conservative identity when a permalink is missing.
export function contentIdentity(card: Element, selector: string, fallback: string) {
  const media = Array.from(card.querySelectorAll("img,video"))
    .filter((el) => el.closest(selector) === card)
    .map((el) => [el.getAttribute("src"), el.getAttribute("poster")].join(" "))
    .join("\n");
  return JSON.stringify([location.pathname + location.search, "content", card.id, card.getAttribute("data-id"), media, fallback]);
}
export function thread(card: Element, site: Site, selector: string) {
  const parent = card.parentElement?.closest(selector);
  const parts = parent ? [cardText(parent, selector)] : [];
  if (site === "reddit") {
    const community = location.pathname.match(/^\/r\/([^/]+)/i)?.[1];
    if (community) parts.push(community.replace(/_/g, " "));
    if (location.pathname.includes("/comments/"))
      parts.push(
        document.querySelector("shreddit-post")?.getAttribute("post-title") ??
          document.querySelector(".thing.link a.title")?.textContent ??
          "",
      );
  }
  if (site === "youtube" && card.matches("ytd-comment-view-model,ytd-comment-renderer")) {
    parts.push(document.querySelector("ytd-watch-metadata h1")?.textContent ?? "");
    const first = card
      .closest("ytd-comment-thread-renderer")
      ?.querySelector("ytd-comment-view-model,ytd-comment-renderer");
    if (first && first !== card) parts.push(cardText(first, selector));
  }
  if (site === "youtube" && location.pathname === "/results" &&
      (card.matches(youtubeShortCards) || card.querySelector("a[href*='/shorts/']"))) {
    parts.push(new URLSearchParams(location.search).get("search_query") ?? "");
  }
  if (site === "x" && /\/status\/\d+/.test(location.pathname)) {
    const root = document.querySelector("article[data-testid=tweet]");
    if (root && root !== card && root.querySelector('a[href="' + location.pathname + '"]'))
      parts.push(cardText(root, selector));
  }
  if (site === "instagram" && card.closest("[role=dialog]")) {
    const post = card.closest("[role=dialog]")?.querySelector("article");
    if (post && post !== card) parts.push(cardText(post, selector));
  }
  return parts.join("\n").slice(0, 12000);
}
