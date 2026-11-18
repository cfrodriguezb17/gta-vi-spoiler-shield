using Npgsql;
var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("Catalog") ?? throw new InvalidOperationException("Set ConnectionStrings__Catalog");
var database = new NpgsqlConnectionStringBuilder(connection) { Timezone = "UTC" };
if (builder.Configuration["DatabasePassword"] is { Length: > 0 } password)
    database.Password = password;
builder.Services.AddSingleton(NpgsqlDataSource.Create(database.ConnectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IDiscovery, Connectors>(c => { c.DefaultRequestHeaders.UserAgent.ParseAdd(builder.Configuration["SourceUserAgent"] ?? "GtaViShield/1.0"); c.MaxResponseContentBufferSize = 8_388_608; });
builder.Services.AddHttpClient<IExtractor, Gemini>();
builder.Services.AddHttpClient<IVectorStore, VectorStore>();
builder.Services.AddSingleton<Catalog>(); builder.Services.AddHostedService<Campaign>();
var app = builder.Build();
var pool = app.Services.GetRequiredService<NpgsqlDataSource>();
await using (var db = await pool.OpenConnectionAsync())
{
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
}
var world = await OfficialWorld.Load(default);
app.MapGet("/api/world", world.Reference);
app.MapGet("/api/spoilers", (long? since, CancellationToken ct) => Catalog.Read(pool, since, ct));
await app.RunAsync();
