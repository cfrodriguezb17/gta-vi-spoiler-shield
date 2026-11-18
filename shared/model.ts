import world from "./official-world.json";

// Every change to tokenisation, weights or dimensions requires a new version.
export const modelVersion = "vi-lex-es-en-384-v1";
export const dimensions = 384;
export const normalize = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘]/g, "'");
export const words = (s: string) => normalize(s).match(/[a-z0-9']+/g) ?? [];

// Fold common Greek and Cyrillic lookalikes and small capitals by glyph.
const lookalikes = new Map(
  Object.entries({
    a: "ΑαАаᴀ", b: "ΒВʙ", c: "ϹСсϲᴄ", d: "ԁᴅ", e: "ΕЕеᴇ", f: "ꜰ", g: "ɡɢ",
    h: "ΗНʜ", i: "ΙІіӀɪ", j: "Јјᴊ", k: "ΚКκкᴋ", l: "ӏʟ", m: "ΜМᴍ", n: "Νɴ",
    o: "ΟοОоᴏ", p: "ΡρРрᴘ", r: "ʀ", s: "Ѕѕꜱ", t: "ΤТтᴛ", u: "ᴜ", v: "νѴѵᴠ",
    w: "ᴡ", x: "ΧχХх", y: "ΥУуʏ", z: "Ζᴢ",
  }).flatMap(([latin, variants]) => Array.from(variants, (glyph) => [glyph, latin] as const)),
);
const lookalikeGlyph = new RegExp(`[${Array.from(lookalikes.keys()).join("")}]`, "gu");
const leet: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
};

// Fold incoming posts before matching so the published encoder and vectors stay compatible.
function readableText(text: string) {
  const letters = normalize(text.replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(lookalikeGlyph, (glyph) => lookalikes.get(glyph) ?? glyph));
  return letters
    .replace(/[a-z0-9][a-z0-9@$]*/g, (word) => {
      if (!/[a-z]/.test(word)) return word;
      if (/^(?:gtavi|gta6|vi|6)[@$]/.test(word)) return word;
      const folded = word.replace(/[0134578@$]/g, (glyph) => leet[glyph]);
      return folded === "gtas" && word.endsWith("5") ? "gta5" : folded;
    })
    .replace(/\b(?:[a-z](?:[.*_·-][a-z]){2,}|n[.*_·-]o)(?![a-z0-9])/g, (word) =>
      word.replace(/[.*_·-]/g, ""),
    );
}
const titleGap = String.raw`[\s\p{P}\p{S}]*`;
const gameTitle = String.raw`\b(?:g${titleGap}t${titleGap}a|grand${titleGap}theft${titleGap}auto)${titleGap}`;
const numeralSix = String.raw`(?:v[\p{P}\p{S}]*i|v[ \t]+i(?=\s*(?::|$))|6|seis|six)`;
const worldNames = [...world.characters, ...world.locations]
  .flatMap(({ context }) => context ?? [])
  .map((name) => words(name).join(String.raw`\W+`))
  .join("|");
const sixthGame = new RegExp(
  gameTitle + numeralSix + String.raw`(?:spoilers?|trailer|leaks?)?\b`,
  "u",
);
const fifthGame = new RegExp(gameTitle + String.raw`(?:v|5)\b`, "u");
const worldContext = new RegExp(String.raw`\b(?:${worldNames})\b`, "u");
function gameContext(text: string) {
  return sixthGame.test(text) || (!fifthGame.test(text) && worldContext.test(text));
}
export const gta = (s: string) => gameContext(readableText(s));
const vocabulary: Record<string, string[]> = {
  betray: [
    "betrays",
    "betrayed",
    "double-crosses",
    "double crosses",
    "sells out",
    "sold out",
    "traiciona a",
    "traicionó a",
    "delata a",
    "vende a",
  ],
  kill: [
    "kills",
    "killed",
    "murders",
    "murdered",
    "shoots dead",
    "takes out",
    "asesina a",
    "asesinó a",
    "mata a",
    "mató a",
    "acaba con",
  ],
  rescue: [
    "rescues",
    "rescued",
    "saves",
    "saved",
    "frees",
    "liberates",
    "rescata a",
    "rescató a",
    "salva a",
    "salvó a",
    "libera a",
  ],
  die: [
    "dies",
    "died",
    "perishes",
    "passes away",
    "is dead",
    "muere",
    "murió",
    "fallece",
    "falleció",
    "pierde la vida",
  ],
  arrest: ["arrests", "arrested", "detains", "detained", "arresta a", "detiene a", "captura a"],
  steal: ["steals", "stole", "takes", "roba", "robó", "se lleva"],
  escape: ["escapes", "escaped", "breaks out", "escapa", "huyó", "huye", "se fuga"],
  reveal: ["reveals", "revealed", "discloses", "revela", "reveló", "desvela", "confiesa"],
  destroy: ["destroys", "destroyed", "blows up", "blows", "destruye", "destruyó", "hace estallar"],
  abandon: ["abandons", "abandoned", "leaves behind", "abandona a", "abandonó a", "deja atrás a"],
  join: ["joins", "joined", "se une a", "se unió a"],
  ally: ["allies with", "teams up with", "se alía con", "se asocia con"],
  survive: ["survives", "survived", "sobrevive", "sobrevivió"],
  prison: ["jail", "cárcel", "prisión"],
  ending: ["final", "finale", "desenlace"],
  mission: ["misión", "quest"],
};
export const actionForms = (key: string) => [key, ...(vocabulary[key] ?? [])];
const leadPair = /\b(?:jason (?:and|y) lucia|lucia (?:and|y) jason)\b/;
const leadDeath = new RegExp(
  String.raw`\b(?:jason|lucia) (?:${actionForms("die").slice(1).map((form) => words(form).join(" ")).join("|")}|was killed|fue asesinad[oa])\b`,
  "u",
);
export function possibleStorySpoiler(text: string, context: string) {
  const readable = readableText(text);
  if (fifthGame.test(readable) || fifthGame.test(readableText(context))) return false;
  const tokens = words(readable).join(" ");
  return leadPair.test(tokens) || leadDeath.test(tokens);
}
const canonical = new Map<string, string>();
for (const [key, list] of Object.entries(vocabulary))
  for (const form of [key, ...list]) canonical.set(words(form).join(" "), key);
const stop = new Set(
  words(
    "el la las los en de del al a con por sus su se que y un una es the in at on to an and of with his her is was gta grand theft auto vi 6",
  ),
);
export type Kernel = {
  accumulate: (slot: number, weight: number) => void;
  clear: () => void;
  finish: () => number;
  memory: WebAssembly.Memory;
};
export async function kernel(bytes: BufferSource): Promise<Kernel> {
  return (await WebAssembly.instantiate(bytes, {})).instance.exports as unknown as Kernel;
}
export function embed(text: string, wasm: Kernel): number[] {
  const tokens = words(text);
  wasm.clear();
  for (let i = 0; i < tokens.length; i++) {
    let term = tokens[i],
      concept = false;
    for (let n = Math.min(4, tokens.length - i); n > 0; n--) {
      const key = canonical.get(tokens.slice(i, i + n).join(" "));
      if (key) {
        term = key;
        i += n - 1;
        concept = true;
        break;
      }
    }
    if (stop.has(term)) continue;
    let hash = 2166136261;
    for (const ch of term) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    wasm.accumulate(hash % dimensions, (hash & 0x80000000 ? -1 : 1) * (concept ? 2 : 1));
  }
  return Array.from(new Float32Array(wasm.memory.buffer, wasm.finish(), dimensions));
}
export type Participant = { name: string; role: "actor" | "target" | "participant"; aliases: string[] };
export type StoryEvent = {
  id: string;
  description: string;
  action: string;
  forms: string[];
  participants: Participant[];
  negated: boolean;
  mission: number | null;
  severity: number;
  confidence: number;
  status: "probable" | "confirmed";
  vector: number[];
};
export function validEvent(e: StoryEvent): boolean {
  const strings = (x: unknown) => Array.isArray(x) && x.every((a) => typeof a === "string");
  return (
    !!e &&
    typeof e.id === "string" &&
    !!e.id &&
    typeof e.description === "string" &&
    typeof e.action === "string" &&
    strings(e.forms) &&
    Array.isArray(e.participants) &&
    e.participants.length > 0 &&
    e.participants.every(
      (p) =>
        p &&
        !!p.name &&
        typeof p.name === "string" &&
        ["actor", "target", "participant"].includes(p.role) &&
        strings(p.aliases),
    ) &&
    typeof e.negated === "boolean" &&
    (e.mission === null || (Number.isSafeInteger(e.mission) && e.mission > 0)) &&
    Number.isFinite(e.severity) &&
    Number.isFinite(e.confidence) &&
    ["probable", "confirmed"].includes(e.status) &&
    Array.isArray(e.vector) &&
    e.vector.length === dimensions &&
    e.vector.every(Number.isFinite)
  );
}
const phrase = (s: string) => " " + words(s).join(" ") + " ";
function positions(text: string, names: string[]) {
  return names.flatMap((name) => {
    const needle = phrase(name);
    const matches: number[] = [];
    for (let pos = text.indexOf(needle); pos >= 0; pos = text.indexOf(needle, pos + 1)) matches.push(pos);
    return matches;
  });
}
function matches(clause: string, e: StoryEvent) {
  const s = phrase(clause);
  if (
    /\b(?:what if|if|si acaso|ojala|imagina|imagine|would|podria|maybe|quizas)\b/.test(s) ||
    clause.includes("?")
  )
    return false;
  const actors = e.participants.filter((p) => p.role === "actor"),
    targets = e.participants.filter((p) => p.role === "target");
  const names = (p: Participant) => positions(s, [p.name, ...p.aliases]);
  const mission = s.match(/\b(?:mission|mision)\s+(\d+)\b/);
  if (mission && e.mission && +mission[1] !== e.mission) return false;
  return [...new Set([...actionForms(e.action), ...e.forms])].some((form) =>
    positions(s, [form]).some((pos) => {
      const before = s.slice(0, pos + 1),
        after = s.slice(pos + phrase(form).length - 1);
      const neg =
        /\b(?:not|never|no|nunca|jamas|didn't|doesn't|won't|isn't|didnt|doesnt)\b(?:\s+\w+){0,3}\s*$/.test(
          before,
        );
      if (neg !== e.negated) return false;
      const passive =
        /\b(?:was|were|is|es|fue|son|fueron)\s+(?:(?:not|never)\s+)?$/.test(before) &&
        /^\s*(?:by|por)\b/.test(after);
      return (
        e.participants.every((p) => names(p).length > 0) &&
        actors.every((p) => names(p).some((n) => (passive ? n > pos : n < pos))) &&
        targets.every((p) => names(p).some((n) => (passive ? n < pos : n > pos)))
      );
    }),
  );
}
export function shouldHide(text: string, context: string, events: StoryEvent[], wasm: Kernel, combined = false) {
  if (!events.length) return false;
  const readable = readableText(text),
    thread = readableText(context);
  if (!gameContext(readable)) {
    if (fifthGame.test(readable)) return false;
    if (!gameContext(thread) && (!combined || fifthGame.test(thread))) return false;
  }
  const reply = /^\s*(?:yes|yeah|exactly|that's right|it was (?:him|her)|si|exacto|asi es|fue el)\b/.test(
    readable,
  );
  const clauses = (reply ? thread + "\n" + readable : readable)
    .split(/[.!;\n]+|\s+(?:but|pero|whereas)\s+/i)
    .filter(Boolean);
  for (const clause of clauses) {
    let vector: number[] | undefined;
    if (events.some((e) => {
      if (!matches(clause, e)) return false;
      const v = vector ??= embed(clause, wasm);
      return e.vector.reduce((sum, x, i) => sum + x * v[i], 0) > 0.04;
    })) return true;
  }
  return false;
}
