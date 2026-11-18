using System.Text.Json;
using Npgsql;

public sealed record OfficialWorld(
    DateOnly VerifiedOn,
    Dictionary<string, WorldSource> Sources,
    WorldCharacter[] Characters,
    WorldLocation[] Locations,
    WorldStory[] Story)
{
    public static async Task<OfficialWorld> Load(CancellationToken ct)
    {
        await using var json = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "official-world.json"));
        return await JsonSerializer.DeserializeAsync<OfficialWorld>(json, Rules.Json, ct)
            ?? throw new InvalidDataException("The official world reference is empty.");
    }

    public object Reference() => new
    {
        VerifiedOn,
        Sources,
        Characters,
        Locations,
        Story = Story.Select(item => new { item.Id, item.Summary, item.Source }),
    };

    public async Task Import(NpgsqlConnection db, Catalog catalog, TimeProvider clock, CancellationToken ct)
    {
        const string official = "rockstar-official";
        var characters = Characters.ToDictionary(character => character.Id);
        var documents = Story.GroupBy(item => item.Source).Select(group =>
        {
            var source = Sources[group.Key];
            if (!Uri.TryCreate(source.Url, UriKind.Absolute, out var url) ||
                url.Scheme != Uri.UriSchemeHttps || url.Host != "www.rockstargames.com" || source.Published is null)
                throw new InvalidDataException("Plot evidence must cite a dated Rockstar Games reference.");

            // The body holds only the verified excerpts, alongside the canonical source URL.
            var facts = group.Select(item => new Fact(
                item.Description, item.Action, item.Forms,
                item.Participants.Select(person => new Person(
                    characters[person.Id].Name, person.Role, characters[person.Id].Aliases ?? [])).ToArray(),
                null, item.Severity, false, item.Passage, true, "")).ToList();
            var document = new Document(group.Key, source.Url, source.Published.Value,
                string.Join("\n", facts.Select(fact => fact.Passage)));
            var hash = Rules.Hash(JsonSerializer.Serialize(new { document, facts }, Rules.Json));
            return (document, facts, hash);
        }).ToList();

        await db.Exec("insert into sources(id) values($1) on conflict do nothing", ct, official);
        var sourceRecord = new Source(official, "curated", "https://www.rockstargames.com/VI", "official");
        foreach (var (document, facts, hash) in documents)
        {
            var prior = await db.Scalar<string>(
                "select hash from documents where source=$1 and reference=$2", ct, official, document.Reference);
            if (hash != prior) await catalog.Store(db, sourceRecord, document, hash, facts, clock.GetUtcNow(), ct);
        }

        var activeReferences = documents.Select(item => item.document.Reference).ToArray();
        var withdrawnHash = Rules.Hash("official reference withdrawn");
        var retired = await db.Rows("""
            select reference,url,published from documents
            where source=$1 and not (reference=any($2)) and hash<>$3
            """, row => new Document(row.GetString(0), row.GetString(1), row.GetFieldValue<DateTimeOffset>(2), ""),
            ct, official, activeReferences, withdrawnHash);
        foreach (var document in retired)
            await catalog.Store(db, sourceRecord, document, withdrawnHash, [], clock.GetUtcNow(), ct);
    }
}

public sealed record WorldSource(string Title, string Url, DateTimeOffset? Published);
public sealed record WorldCharacter(string Id, string Name, string Summary, string Source, string[]? Aliases, string[]? Context);
public sealed record WorldLocation(string Name, string Summary, string Source, string[]? Context);
public sealed record WorldParticipant(string Id, string Role);
public sealed record WorldStory(
    string Id, string Source, string Summary, string Description, string Action, string[] Forms,
    WorldParticipant[] Participants, string Passage, int Severity);
