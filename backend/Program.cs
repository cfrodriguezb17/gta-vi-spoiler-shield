using Npgsql;
var builder = WebApplication.CreateBuilder(args);
if (int.TryParse(Environment.GetEnvironmentVariable("PORT"), out var port))
    builder.WebHost.UseUrls($"http://[::]:{port}");
var connection = builder.Configuration.GetConnectionString("Catalog") ?? throw new InvalidOperationException("Set ConnectionStrings__Catalog");
var database = new NpgsqlConnectionStringBuilder(connection) { Timezone = "UTC" };
if (builder.Configuration["DatabasePassword"] is { Length: > 0 } password)
    database.Password = password;
builder.Services.AddSingleton(NpgsqlDataSource.Create(database.ConnectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IDiscovery, Connectors>(c => { c.DefaultRequestHeaders.UserAgent.ParseAdd(builder.Configuration["SourceUserAgent"] ?? "GtaViShield/1.0"); c.MaxResponseContentBufferSize = 8_388_608; });
builder.Services.AddHttpClient<IExtractor, Gemini>();
builder.Services.AddHttpClient<IVectorStore, VectorStore>();
builder.Services.AddSingleton<Catalog>();
if (builder.Configuration.GetValue("CampaignEnabled", true)) builder.Services.AddHostedService<Campaign>();
PublicApi.Configure(builder.Services, builder.Configuration);
var app = builder.Build();
var pool = app.Services.GetRequiredService<NpgsqlDataSource>();
if (args.Contains("migrate"))
{
    await using var db = await pool.OpenConnectionAsync();
    await using var tx = await db.BeginTransactionAsync();
    await db.Exec("select pg_advisory_xact_lock(64301002)", default);
    bool exact = builder.Configuration.GetValue<bool>("ExactVectors");
    if (!exact) await db.Exec("create extension if not exists vector", default);
    var schema = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "schema.sql"));
    await db.Exec(schema.Replace("VECTOR_TYPE", exact ? "real[]" : "vector(384)").Replace("VECTOR_INDEX", exact ? "" : "CREATE INDEX IF NOT EXISTS event_hnsw ON events USING hnsw(embedding vector_cosine_ops);"), default);
    await db.Exec("insert into catalog_model(id,model) values(1,$1) on conflict do nothing", default, Rules.Model);
    if (await db.Scalar<string>("select model from catalog_model where id=1", default) != Rules.Model)
        throw new InvalidOperationException("This database uses a different encoder. Build the new catalog in a separate database.");
    await tx.CommitAsync();
    Console.WriteLine("Catalog schema ready.");
    return;
}
if (args.Any(arg => arg is "start-campaign" or "status" or "import-official-world"))
{
    await using var db = await pool.OpenConnectionAsync();
    if (args.Contains("start-campaign"))
    {
        await Campaign.Start(db, DateTimeOffset.UtcNow, default);
        Console.WriteLine("Campaign scheduled. The running worker checks for due reviews every five seconds."); return;
    }
    if (args.Contains("status"))
    {
        var report = await db.Scalar<string>("""
        select json_build_object('startedUtc',started,'endsUtc',started+interval '120 hours',
        'completed',(select count(*) from reviews where status='completed'),'missed',(select count(*) from reviews where status='missed'),
        'failures',(select coalesce(json_agg(row_to_json(f)),'[]') from (select source,count(*) as failures,max(slot) as last_failed_slot from runs where status='failed' group by source) f),
        'geminiRequests',requests,'geminiTokens',tokens,'version',(select coalesce(max(version),0) from changes))::text from campaign
        """, default);
        Console.WriteLine(report ?? "{\"startedUtc\":null}"); return;
    }
    if (args.Contains("import-official-world"))
    {
        var reference = await OfficialWorld.Load(default);
        await reference.Import(db, app.Services.GetRequiredService<Catalog>(), TimeProvider.System, default);
        Console.WriteLine($"Official reference loaded with {reference.Story.Length} plot events.");
        return;
    }
    throw new ArgumentException("Unknown operator command");
}
var world = await OfficialWorld.Load(default);
PublicApi.Map(app, world, pool);
await app.RunAsync();
