using System.Text.Json;
using Npgsql;

public sealed record ReviewedStory(string SourceId, string Url, DateTimeOffset Published, string Body, List<Fact> Facts)
{
    public static async Task<int> Import(ReviewedStory[]? input, NpgsqlConnection db, Catalog catalog,
        IConfiguration config, TimeProvider clock, CancellationToken ct)
    {
        if (input is not { Length: > 0 }) throw new InvalidDataException("Supply at least one reviewed article.");

        var sources = (config.GetSection("Sources").Get<Source[]>() ?? []).ToDictionary(source => source.Id);
        var articles = new HashSet<(string Source, string Url)>();
        var documents = input.Select(item =>
        {
            if (item == null || string.IsNullOrWhiteSpace(item.SourceId) || !sources.TryGetValue(item.SourceId, out var source) ||
                source.Trust is not ("guide" or "editorial"))
                throw new InvalidDataException("Each reviewed article must come from a configured editorial or guide source.");

            if (!Uri.TryCreate(item.Url, UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps ||
                url.UserInfo.Length != 0 || url.Fragment.Length != 0 || !url.IsDefaultPort ||
                Host(url) != Host(new Uri(source.Url)) || !articles.Add((source.Id, url.AbsoluteUri)))
                throw new InvalidDataException("Each article must have a unique HTTPS URL on its source's domain.");

            if (item.Published == default || string.IsNullOrWhiteSpace(item.Body) || item.Facts == null ||
                item.Facts.Any(fact => !Rules.Supported(fact, item.Body) || !fact.Direct || !string.IsNullOrEmpty(fact.Origin)))
                throw new InvalidDataException("Each article must be dated and any facts must cite exact first-hand passages.");

            // Keep independently reviewed evidence separate from extraction based on a feed summary.
            var reviewedSource = source with { Id = source.Id + "-reviewed" };
            var document = new Document(url.AbsoluteUri, url.AbsoluteUri, item.Published, item.Body);
            var hash = Rules.Hash(JsonSerializer.Serialize(new { document, item.Facts }, Rules.Json));
            return (reviewedSource, document, hash, item.Facts);
        }).ToArray();

        // Share the campaign's writer lock while updating events and evidence.
        await db.Exec("select pg_advisory_lock(64301001)", ct);
        try
        {
            foreach (var (source, document, hash, facts) in documents)
            {
                await db.Exec("insert into sources(id) values($1) on conflict do nothing", ct, source.Id);
                if (await db.Scalar<string>("select hash from documents where source=$1 and reference=$2", ct, source.Id, document.Reference) != hash)
                    await catalog.Store(db, source, document, hash, facts, clock.GetUtcNow(), ct);
            }
        }
        finally { await db.Exec("select pg_advisory_unlock(64301001)", CancellationToken.None); }

        return documents.Length;
    }

    private static string Host(Uri url) => url.IdnHost.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
        ? url.IdnHost[4..].ToLowerInvariant() : url.IdnHost.ToLowerInvariant();
}
