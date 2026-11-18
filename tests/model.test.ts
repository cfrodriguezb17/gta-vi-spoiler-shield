import { expect, test } from "bun:test";
import { kernel, embed, gta, shouldHide, type StoryEvent } from "../shared/model";
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
for (const [lang, set] of Object.entries(cases))
  test("held-out sentences " + lang, () => {
    const score = (q: string) => shouldHide(q, "", catalog, null, wasm);
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
test("reply context, unknown missions, mixed posts and progress", () => {
  const check = (s: string, ctx = "", p: number | null = 7) => shouldHide(s, ctx, catalog, p, wasm);
  expect(check("Sí, fue él", "GTA VI Rex rescata a Iris")).toBe(true);
  expect(check("Gracias por la música", "GTA VI Rex rescata a Iris")).toBe(false);
  expect(check("GTA VI Rhea betrays Milo")).toBe(false);
  expect(check("GTA VI Rhea betrays Milo. Rex rescues Iris")).toBe(true);
  expect(check("GTA VI Professor Vale dies", "", 999)).toBe(true);
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

  const check = (s: string, ctx = "") => shouldHide(s, ctx, catalog, null, wasm);
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
  const hides = (text: string, context = "") => shouldHide(text, context, published, null, wasm);

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
});
