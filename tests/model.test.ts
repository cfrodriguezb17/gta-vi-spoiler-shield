import { expect, test } from "bun:test";
import { catalogParticipantTokens, mayMentionParticipant, kernel, embed, gta, possibleStorySpoiler, shouldHide, type StoryEvent } from "../shared/model";
import cases from "./cases.json";
import world from "../shared/official-world.json";
const wasm = await kernel(await Bun.file("shared/vector.wasm").arrayBuffer());
function event(
  id: string,
  description: string,
  action: string,
  actor: string,
  target: string | null,
  mission: number | null,
  forms: string[],
  actorAliases: string[] = [],
  targetAliases: string[] = [],
): StoryEvent {
  return {
    id,
    description,
    action,
    forms,
    mission,
    vector: embed(description, wasm),
    negated: false,
    severity: 5,
    confidence: 0.95,
    status: "confirmed",
    participants: [
      { name: actor, role: "actor", aliases: actorAliases },
      ...(target ? [{ name: target, role: "target" as const, aliases: targetAliases }] : []),
    ],
  };
}
const catalog = [
  event("1", "Rhea betrays Milo", "betray", "Rhea", "Milo", 7, ["traicionado", "betrayed"], [], ["Miles"]),
  event("2", "Rex rescues Iris", "rescue", "Rex", "Iris", 9, ["rescued", "rescatada"]),
  event("3", "Professor Vale dies", "die", "Professor Vale", null, null, [], ["Prof Vale"]),
];
test("the local participant check preserves catalog matches, aliases and inherited context", () => {
  const tokens = new Set(catalogParticipantTokens(catalog));
  for (const set of Object.values(cases)) {
    for (const text of set.spoilers) expect(mayMentionParticipant(text, "", tokens)).toBe(true);
  }
  expect(mayMentionParticipant("Sí, fue él", "R3x r3scat4 a Irіs", tokens)).toBe(true);
  expect(mayMentionParticipant("𝔊𝔗𝔄 Ⅵ: R.h.e.a b3trayѕ M\u200bilо", "", tokens)).toBe(true);
  expect(mayMentionParticipant("Prof Vale dies", "", tokens)).toBe(true);
  expect(mayMentionParticipant("A cat plays the piano", "", tokens)).toBe(false);
  expect(catalogParticipantTokens([event("x", "example", "die", "Rex", null, null, [], ["🎮"])])).toBeNull();
});
for (const [lang, set] of Object.entries(cases))
  test("held-out sentences " + lang, () => {
    const score = (q: string) => shouldHide(q, "", catalog, wasm);
    const missed = set.spoilers.filter((s) => !score(s)),
      falsePos = set.safe.filter(score);
    console.log(lang, {
      detected: set.spoilers.length - missed.length,
      severe: set.spoilers.length,
      falsePositives: falsePos.length,
      innocuous: set.safe.length,
      missed,
      falsePos,
    });
    expect(missed.length / set.spoilers.length).toBeLessThanOrEqual(0.1);
    expect(falsePos.length / set.safe.length).toBeLessThanOrEqual(0.05);
  });
test("reply context, unknown missions and mixed posts", () => {
  const check = (s: string, ctx = "") => shouldHide(s, ctx, catalog, wasm);
  expect(check("Sí, fue él", "GTA VI Rex rescata a Iris")).toBe(true);
  expect(check("Gracias por la música", "GTA VI Rex rescata a Iris")).toBe(false);
  expect(check("GTA VI Rhea betrays Milo")).toBe(true);
  expect(check("GTA VI Rhea betrays Milo. Rex rescues Iris")).toBe(true);
  expect(check("GTA VI Professor Vale dies")).toBe(true);
  expect(check("GTA V Rex saves Iris", "GTA VI")).toBe(false);
  expect(gta("r/GTA6")).toBe(true);
  expect(gta("GTA VII")).toBe(false);
});
test("detects disguised game names and events in both languages", () => {
  for (const title of [
    "𝔊𝔗𝔄 Ⅵ",
    "ＧＴＡ ６",
    "G\u200bT\u2060A V\u00adI",
    "GТΑ VІ",
    "ɢᴛᴀ ᴠɪ",
    "G.T.A. V.I.",
    "G T A V I",
    "G⭐T⭐A 6",
    "GT4 6",
    "#G74VI",
    "Luсía Cаminos",
    "GTA VI@Rockstar",
  ]) expect(gta(title), title).toBe(true);

  const check = (s: string, ctx = "") => shouldHide(s, ctx, catalog, wasm);
  expect(check("GТΑ VІ: Rhеa tr@ici0n4 a M1l0")).toBe(true);
  expect(check("𝔊𝔗𝔄 Ⅵ: R.h.e.a b3trayѕ M\u200bilо")).toBe(true);
  expect(check("G.T.A. V.I.: Rhea tra1ciona a Milo en la misión ７")).toBe(true);
  expect(check("Sí, fue él", "G\u200bTA 6: R3x r3scat4 a Irіs")).toBe(true);
  expect(check("GТΑ VІ: Rheа n0 tr@iciona a Milо")).toBe(false);
  expect(check("GТΑ VІ: Rheа n.o traiciona a Milо")).toBe(false);
  expect(check("GТΑ VІ: M1lo b3trays Rhеa")).toBe(false);
  expect(check("G.T.A. V.I.: Rhea tra1ciona a Milo en la misión ８")).toBe(false);
  expect(check("GT4 5: Rhea betrays Milo", "GTA VI")).toBe(false);
  expect(check("GТΑ VІ: tráiler oficial y música")).toBe(false);
  expect(gta("GTA V. I enjoyed playing it.")).toBe(false);
  expect(gta("GТΑ VІІ")).toBe(false);
});
test("encoder is deterministic, finite, unit-normalized, and bilingual", () => {
  const a = embed("Rhea betrays Milo", wasm),
    b = embed("Rhea traiciona a Milo", wasm);
  expect(a).toEqual(b);
  expect(a.length).toBe(384);
  expect(a.reduce((s, x) => s + x * x, 0)).toBeCloseTo(1);
});
test("combined checks plot matches without a game reference and flags short rumors", () => {
  const check = (text: string, context = "") => shouldHide(text, context, catalog, wasm, true);
  expect(shouldHide("Rhea betrays Milo", "", catalog, wasm)).toBe(false);
  expect(check("Rhea betrays Milo")).toBe(true);
  expect(check("Rhеa tr@ici0n4 a M1l0")).toBe(true);
  expect(check("Sí, fue él", "Rex rescata a Iris")).toBe(true);
  expect(check("Milo betrays Rhea")).toBe(false);
  expect(check("Rhea no traiciona a Milo")).toBe(false);
  expect(check("Rhea betrays Milo", "GTA V")).toBe(false);
  expect(check("Rhea and Milo review a trailer")).toBe(false);
  expect(possibleStorySpoiler("Luсía muer3", "")).toBe(true);
  expect(possibleStorySpoiler("Jason was killed", "")).toBe(true);
  expect(possibleStorySpoiler("Un clip de Jason y Lucía", "")).toBe(true);
  expect(possibleStorySpoiler("Lucía recomienda una película", "")).toBe(false);
  expect(possibleStorySpoiler("Lucía no muere", "")).toBe(false);
  expect(possibleStorySpoiler("Lucía muere", "GTA V")).toBe(false);
});
test("official world context and plot stay distinct in intelligent mode", () => {
  const published: StoryEvent[] = world.story.map((fact) => ({
    ...fact,
    participants: fact.participants.map(({ id, role }) => {
      const profile = world.characters.find((person) => person.id === id)!;
      return { name: profile.name, aliases: profile.aliases ?? [], role: role as "actor" | "participant" };
    }),
    mission: null,
    negated: false,
    status: "confirmed",
    confidence: 0.95,
    vector: embed(fact.description, wasm),
  }));
  const hides = (text: string, context = "") => shouldHide(text, context, published, wasm);

  expect(gta("Visita a Pоrt Gellhorn y Cal Hampton")).toBe(true);
  expect(gta("Dre’Quan Priest y Bae-Luxe")).toBe(true);
  expect(gta("Paseo por Vice City y Liberty City")).toBe(false);
  expect(gta("GTA V: charla sobre Cal Hampton")).toBe(false);
  expect(hides("Lucía sale de prisión", "Penitenciaría de Leonida")).toBe(true);
  expect(hides("Lucia Caminos is released from prison")).toBe(true);
  expect(hides("Jason works for drug runners", "Leonida Keys")).toBe(true);
  expect(hides("Jason y Lucía: su atraco salió mal", "Cayos de Leonida")).toBe(true);
  expect(hides("Jason Duval and Lucia are drawn into a criminal conspiracy")).toBe(true);
  expect(hides("GTA VI: tráiler oficial y fotos de Port Gellhorn")).toBe(false);
  expect(hides("GTA VI: Lucia no sale de prisión")).toBe(false);
  expect(hides("GTA V: Lucia Caminos sale de prisión", "GTA VI")).toBe(false);
  expect(hides("GTA VI: Lucía muere")).toBe(false);
  expect(shouldHide("Lucía sale de prisión", "", published, wasm, true)).toBe(true);
});
