import type { Site } from "./api";
const youtubeVideoCards = "ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-compact-video-renderer";
export const selectors: Record<Site, string> = {
  reddit:
    "shreddit-post,shreddit-comment,.thing.link,.thing.comment,[data-testid=post-container],[data-testid=comment]",
  youtube: [
    youtubeVideoCards,
    `yt-lockup-view-model:not(:is(${youtubeVideoCards}) *)`,
    "ytd-comment-view-model,ytd-comment-renderer,ytd-reel-video-renderer,ytm-video-with-context-renderer,ytd-watch-metadata",
  ].join(","),
  x: "article[data-testid=tweet],[data-testid=cellInnerDiv] [role=article]",
  facebook: "[role=article],[data-pagelet^=FeedUnit_],div[aria-posinset][aria-describedby]",
  instagram:
    "article,[role=dialog] ul li,main a[href^='/p/']:not(article a),main a[href^='/reel/']:not(article a)",
};
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
export function cardText(card: Element, selector: string) {
  const parts: string[] = [];
  const visit = (node: Node) => {
    if (node instanceof Text) {
      if (node.textContent?.trim()) parts.push(node.textContent.trim());
      return;
    }
    if (
      !(node instanceof Element) ||
      node.matches("script,style,template,[data-vi-notice]") ||
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
      const value = node.getAttribute(attr);
      if (value) parts.push(value);
    }
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
      for (const id of (node.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
        const label = document.getElementById(id)?.textContent?.trim();
        if (label) parts.push(label.slice(0, 1000));
      }
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(card);
  return [...new Set(parts)].join(" ").slice(0, 12000);
}
export function identity(card: Element, site: Site, selector: string, fallback: string) {
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
  // Preserve the full comparison for cards without a reliable publication reference.
  const media = Array.from(card.querySelectorAll("img,video"))
    .filter((el) => el.closest(selector) === card)
    .map((el) => [el.getAttribute("src"), el.getAttribute("poster")].join(" "))
    .join("\n");
  return JSON.stringify([route, "content", card.id, card.getAttribute("data-id"), media, fallback]);
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
