using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

var original = Environment.GetEnvironmentVariable("TEST_DATABASE") ?? throw new Exception("Set TEST_DATABASE to a disposable PostgreSQL database");
var temp = "test_" + Guid.NewGuid().ToString("N");
await using var admin = new NpgsqlConnection(original); await admin.OpenAsync();
await admin.Exec("create schema " + temp, default);
var useHnsw = Environment.GetEnvironmentVariable("TEST_PGVECTOR") == "1";
try
{
    var cs = new NpgsqlConnectionStringBuilder(original) { SearchPath = temp + ",public" };
    await using var pool = NpgsqlDataSource.Create(cs.ConnectionString);
    await using var db = await pool.OpenConnectionAsync();
    var schema = await File.ReadAllTextAsync("backend/schema.sql");
    if (useHnsw) await db.Exec("create extension if not exists vector with schema public", default);
    await db.Exec(schema.Replace("VECTOR_TYPE", useHnsw ? "vector(384)" : "real[]").Replace("VECTOR_INDEX", useHnsw ? "create index on events using hnsw(embedding vector_cosine_ops)" : ""),
        default);
    var clock = new TestClock();
    var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["ExactVectors"] = (!useHnsw).ToString(),
        ["EncoderUrl"] = Environment.GetEnvironmentVariable("TEST_ENCODER_URL"),
        ["Gemini:MaxRequests"] = "12",
        ["Gemini:Key"] = "fixture",
        ["Sources:0:Id"] = "limited",
        ["Sources:0:Kind"] = "feed",
        ["Sources:0:Url"] = "https://limited.invalid/feed",
        ["Sources:1:Id"] = "guide",
        ["Sources:1:Kind"] = "feed",
        ["Sources:1:Url"] = "https://guide.invalid/feed",
        ["Sources:1:Trust"] = "guide",
        ["Sources:2:Id"] = "mirror",
        ["Sources:2:Kind"] = "feed",
        ["Sources:2:Url"] = "https://mirror.invalid/feed"
    }).Build();
    var source = new SourceFixture(); var gemini = new Gemini(new HttpClient(new GeminiFixture()), config);
    var vectors = new VectorStore(new HttpClient(), config); var catalog = new Catalog(vectors, config);
    Campaign Worker() => new(pool, config, clock, new Connectors(new HttpClient(source), config), gemini, catalog, NullLogger<Campaign>.Instance);
    Task<long> Number(string sql) => db.Scalar<long>(sql, default);
    async Task<Batch> Read(long? since) => (Batch)((IValueHttpResult)await Catalog.Read(pool, since, default)).Value!;
    await Campaign.Start(db, clock.Now, default); await Campaign.Start(db, clock.Now.AddHours(1), default);
    Check(await Number("select count(*) from reviews") == 120, "exactly 120 scheduled reviews");
    var worker = Worker(); await worker.Tick(default);
    var one = await Read(null); Check(one.Added.Length == 1 && one.Added[0]["status"]!.GetValue<string>() == "probable", "guide publication");
    var id = one.Added[0]["id"]!.ToString();
    Check(await Number("select count(*) from documents where reference='real-trailer'") == 1, "official trailer title traversed RSS, extractor and storage");
    Check(await Number("select count(*) from evidence") == 1, "one passage despite duplicate extracted claim");
    Check(await Number("select count(*) from documents where reference='unsupported'") == 1 &&
        await Number("select count(*) from runs where source='guide' and slot=0 and status='ok' and detail like '%claims discarded: 2'") == 1,
        "unsupported passages in mixed and empty extractions do not abort a source");
    Check(await Number("select count(*) from runs where status='failed'") == 1, "quota failure isolated");
    source.Stage = 1; clock.Now = clock.Now.AddHours(1); await Worker().Tick(default);
    Check(await Number("select count(*) from revisions where document=(select id from documents where reference='story' and source='guide')") == 1,
        "an edit with no supported extraction preserves active evidence until a later retry");
    var two = await Read(one.Version); Check(two.Updated.Length == 1 && two.Updated[0]["id"]!.ToString() == id && two.Updated[0]["status"]!.ToString() == "confirmed", "restart and second independent origin");
    clock.Now = clock.Now.AddHours(4); source.Stage = 2; await worker.Tick(default);
    var three = await Read(two.Version); Check(three.Deleted.Length == 1 && three.Deleted[0].ToString() == id, "withdrawal after source correction");
    Check(await Number("select count(*) from reviews where status='missed'") == 3, "missed hours accounted for");
    Check(await Number("select count(*) from revisions") > await Number("select count(*) from documents"), "revision history");
    var transient = await Read(0); Check(transient.Added.Length + transient.Deleted.Length + transient.Updated.Length == 0, "collapsed transient publication");
    Check((await Catalog.Read(pool, three.Version + 1, default) as IStatusCodeHttpResult)?.StatusCode == 410, "invalid cursor");
    for (int i = 6; i < 120; i++) { clock.Now = clock.Now.AddHours(1); await worker.Tick(default); }
    Check(await Number("select count(*) from reviews where status='completed'") == 117, "all remaining slots executed");
    var calls = source.Requests; clock.Now = clock.Now.AddHours(1); await worker.Tick(default); Check(calls == source.Requests, "no crawling after five days");
    Check(await Number("select tokens from campaign") > 0, "Gemini usage recorded");
    await db.Exec("update campaign set requests=12", default);
    try { await gemini.Extract(db, new("id", "https://source.invalid", clock.Now, "test"), default); throw new Exception("quota not enforced"); }
    catch (InvalidOperationException e) when (e.Message.Contains("budget")) { }
    Check(Rules.State(1, false, false) == "candidate" && Rules.State(2, false, false) == "probable" && Rules.State(1, true, true) == "confirmed", "corroboration thresholds");
    Check(Rules.IndependentOrigins([("guide", "first passage"), ("mirror", "first passage"), ("mirror", "translation"), ("unattributed-report", "third version")]) == 1, "copied and unattributed rumors");
    var author = new Source("guide", "feed", "https://guide.invalid", "official");
    async Task Record(string reference, Fact assertion)
    {
        var doc = new Document(reference, "https://guide.invalid/" + reference, clock.Now, assertion.Passage);
        await catalog.Store(db, author, doc, Rules.Hash(doc.Body), [assertion], clock.Now, default);
    }
    var directed = new Fact("Rex rescues Iris", "rescue", ["rescues", "rescata a"], [new("Rex", "actor", ["Rexx"]), new("Iris", "target", [])], 4, 5, false, "Rex rescues Iris at the pier.", true, "");
    await Record("original", directed); await Record("original", directed);
    await Record("translation", directed with { Description = "Rexx rescata a Iris", Action = "rescatar", Participants = [new("Rexx", "actor", []), new("Iris", "target", [])], Passage = "Rexx rescata a Iris." });
    var translated = await Read(null); Check(translated.Added.Length == 1, "translation with an alias merged");
    Check(await Number("select count(*) from evidence where document=(select id from documents where reference='original')") == 1, "repeat ingestion is idempotent");
    await Record("reversed", directed with { Participants = [new("Iris", "actor", []), new("Rex", "target", [])], Passage = "Iris rescues Rex." });
    await Record("negated", directed with { Negated = true, Passage = "Rex never rescues Iris." });
    await Record("other-mission", directed with { Mission = 8, Passage = "During mission 8 Rex rescues Iris." });
    Check((await Read(null)).Added.Length == 4, "actor, target, negation and incompatible mission stay separate");
    config["YouTube:Key"] = "fixture";
    config["Reddit:Token"] = "fixture";
    var social = new Connectors(new HttpClient(new SocialFixture()), config);
    var videos = await social.Read(new("videos","youtube","https://www.googleapis.com/youtube/v3/search?q=GTA6"),
        new(clock.Now,"recent",["older-video"]),default);
    Check(videos.Count == 2 && videos.Any(v=>v.Reference=="older-video" && v.Body.Contains("edited description")), "YouTube revisits known video descriptions");
    var posts = await social.Read(new("posts","reddit","https://oauth.reddit.com/r/GTA6/new"),
        new(clock.Now,"recent",["t3_old"]),default);
    Check(posts.Count == 2 && posts.Any(v=>v.Reference=="t3_old" && v.Origin=="reddit:original"), "Reddit revisits known posts outside the listing");
    Console.WriteLine("Campaign, connectors, Gemini protocol, catalog deltas and expiry passed.");
}
finally { await admin.Exec("drop schema " + temp + " cascade", default); }
static void Check(bool condition, string label) { if (!condition) throw new Exception(label); Console.WriteLine("ok " + label); }
sealed class TestClock : TimeProvider
{
    public DateTimeOffset Now = new(2030, 1, 1, 0, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => Now;
}
sealed class SourceFixture : HttpMessageHandler
{
    public int Stage, Requests;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        Requests++; if (req.RequestUri!.Host == "limited.invalid") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.TooManyRequests));
        bool mirror = req.RequestUri.Host == "mirror.invalid";
        string text = mirror ? "In GTA VI, Rhea betrayed Milo." : Stage switch
        {
            1 => "In GTA VI, Rhea betrays Milo. Unsupported-only report.",
            2 => "The guide retracts its earlier report.",
            _ => "In GTA VI, Rhea betrays Milo."
        };
        string story = mirror && Stage == 0 ? "" : "<item><guid>story</guid><title>" + text + "</title><link>https://" + req.RequestUri.Host + "/story</link></item>";
        // Identifying title of Rockstar's public trailer; the XML transport is a fixture.
        string trailer = mirror ? "" : "<item><guid>real-trailer</guid><title>Grand Theft Auto VI Trailer 1</title><link>https://www.youtube.com/watch?v=QdBZY2fkU-0</link></item>";
        string rejected = mirror ? "" : "<item><guid>unsupported</guid><title>Unsupported-only report</title><link>https://guide.invalid/unsupported</link></item>";
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<rss><channel>" + rejected + story + trailer + "</channel></rss>") });
    }
}
sealed class GeminiFixture : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        using var request = JsonDocument.Parse(await req.Content!.ReadAsStringAsync(ct));
        var generation = request.RootElement.GetProperty("generationConfig");
        if (req.RequestUri!.AbsolutePath != "/v1beta/models/gemini-3.5-flash-lite:generateContent" ||
            generation.TryGetProperty("temperature", out _) ||
            generation.GetProperty("responseMimeType").GetString() != "application/json" ||
            generation.GetProperty("responseJsonSchema").GetProperty("type").GetString() != "array")
            throw new InvalidDataException("Incompatible Gemini structured output request");
        string body = request.RootElement.GetProperty("contents")[0].GetProperty("parts")[0].GetProperty("text").GetString()!;
        var fact = new Fact("Rhea betrays Milo", "betray", ["betrays", "traiciona a"], [new("Rhea", "actor", []), new("Milo", "target", [])], 7, 5, false, body.Trim(), true, "");
        var unsupported = fact with { Passage = "This passage does not appear in the article" };
        Fact[] extracted = body.Contains("Unsupported-only") ? [unsupported] : body.Contains("betray") ? [fact, fact, unsupported] : [];
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { usageMetadata = new { totalTokenCount = 45 }, candidates = new[] { new { finishReason = "STOP", content = new { parts = new[] { new { text = JsonSerializer.Serialize(extracted, Rules.Json) } } } } } }) };
    }
}
