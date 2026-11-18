using Npgsql;
public class Campaign(NpgsqlDataSource pool, IConfiguration cfg, TimeProvider clock, IDiscovery discovery, IExtractor extractor, Catalog catalog, ILogger<Campaign> log) : BackgroundService
{
    public static async Task Start(NpgsqlConnection db, DateTimeOffset now, CancellationToken ct)
    {
        await using var tx = await db.BeginTransactionAsync(ct);
        await db.Exec("insert into campaign(id,started) values(1,$1) on conflict do nothing", ct, now.UtcDateTime);
        await db.Exec("insert into reviews(slot,scheduled) select i,started+i*interval '1 hour' from campaign,generate_series(0,119) i on conflict do nothing", ct);
        await tx.CommitAsync(ct);
    }
    public async Task Tick(CancellationToken ct)
    {
        await using var db = await pool.OpenConnectionAsync(ct);
        if (!await db.Scalar<bool>("select pg_try_advisory_lock(64301001)", ct)) return;
        try
        {
            var start = await db.Scalar<DateTime>("select started from campaign where id=1", ct); if (start == default) return;
            var now = clock.GetUtcNow(); int slot = Rules.Slot(start, now); if (slot < 0) return;
            await db.Exec("update reviews set status='missed',finished=$2 where slot<$1 and status in ('pending','running')", ct, slot, now.UtcDateTime);
            if (slot >= 120) return;
            bool due = await db.Scalar<bool>("update reviews set status='running' where slot=$1 and status in ('pending','running') returning true", ct, slot);
            if (!due) return;
            using var deadline = new CancellationTokenSource(new DateTimeOffset(start).AddHours(120) - now, clock);
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, deadline.Token);
            var active = linked.Token;
            foreach (var source in cfg.GetSection("Sources").Get<Source[]>() ?? [])
            {
                active.ThrowIfCancellationRequested();
                if (await db.Scalar<bool>("select exists(select 1 from runs where slot=$1 and source=$2 and status='ok')", active, slot, source.Id)) continue;
                string status = "ok"; string? detail = null;
                int unsupported = 0;
                try
                {
                    await db.Exec("insert into sources(id) values($1) on conflict do nothing", active, source.Id);
                    var pos = (await db.Rows("select cursor_at,cursor_ref from sources where id=$1", r => new Position(r.IsDBNull(0) ? null : r.GetDateTime(0), r.IsDBNull(1) ? null : r.GetString(1)), active, source.Id)).Single();
                    if (source.Kind is "reddit" or "youtube")
                        pos = pos with { Known = (await db.Rows("select reference from documents where source=$1", r => r.GetString(0), active, source.Id)).ToArray() };
                    var docs = await discovery.Read(source, pos, active);
                    foreach (var doc in docs.OrderBy(d => d.Published).ThenBy(d => d.Reference, StringComparer.Ordinal))
                    {
                        string hash = Rules.Hash(System.Text.Json.JsonSerializer.Serialize(new { doc.Body, doc.Url, doc.Origin, published = doc.Published.UtcDateTime }));
                        string? prior = await db.Scalar<string>("select hash from documents where source=$1 and reference=$2", active, source.Id, doc.Reference);
                        bool relevant = !source.FilterGame || System.Text.RegularExpressions.Regex.IsMatch(doc.Body, @"\b(?:gta|grand\s*theft\s*auto)[\s:-]*(?:vi|6)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                        if (hash != prior && (prior != null || relevant))
                        {
                            var extracted = relevant ? await extractor.Extract(db, doc, active) : [];
                            var supported = extracted.Where(f => Rules.Supported(f, doc.Body)).ToList();
                            unsupported += extracted.Count - supported.Count;
                            // Retry an edit with only invalid claims before replacing existing evidence.
                            if (prior != null && extracted.Count > 0 && supported.Count == 0) continue;
                            await catalog.Store(db, source, doc, hash, supported, clock.GetUtcNow(), active);
                        }
                        await db.Exec(@"update sources set cursor_at=$2,cursor_ref=$3 where id=$1 and (cursor_at is null or (cursor_at,cursor_ref)<=($2,$3))",
                            active, source.Id, doc.Published.UtcDateTime, doc.Reference);
                    }
                }
                catch (Exception e) when (!active.IsCancellationRequested)
                {
                    status = "failed"; detail = e is HttpRequestException http ? "HTTP " + http.StatusCode : e.GetType().Name + ": " + e.Message;
                    log.LogWarning("Review {Slot}, source {Source}: {Detail}", slot, source.Id, detail);
                }
                if (unsupported > 0)
                {
                    string rejected = $"Unsupported extracted claims discarded: {unsupported}";
                    detail = detail == null ? rejected : $"{detail}. {rejected}";
                    log.LogWarning("Review {Slot}, source {Source}: {Detail}", slot, source.Id, rejected);
                }
                await db.Exec(@"insert into runs(slot,source,status,detail) values($1,$2,$3,$4) on conflict(slot,source)
                    do update set status=excluded.status,detail=excluded.detail", active, slot, source.Id, status, detail);
            }
            await db.Exec("update reviews set status='completed',finished=$2 where slot=$1", active, slot, clock.GetUtcNow().UtcDateTime);
        }
        finally { await db.Exec("select pg_advisory_unlock(64301001)", CancellationToken.None); }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Tick(stoppingToken); } catch (Exception ex) when (!stoppingToken.IsCancellationRequested) { log.LogError(ex, "Campaign tick interrupted"); }
            await Task.Delay(TimeSpan.FromSeconds(5), clock, stoppingToken);
        }
    }
}
