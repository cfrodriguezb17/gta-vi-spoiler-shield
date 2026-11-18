using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;

public static class PublicApi
{
    private static int Limit(IConfiguration config, string key, int fallback) =>
        Math.Clamp(config.GetValue("Limits:" + key, fallback), 1, 100_000);

    private static string Client(HttpContext ctx, bool railwayIngress)
    {
        if (!railwayIngress) return ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var header = ctx.Request.Headers["X-Real-IP"];
        return header.Count == 1 && IPAddress.TryParse(header[0], out var ip) ? ip.ToString() : "unknown";
    }

    private static PartitionedRateLimiter<HttpContext> Quota(int max, bool snapshotsOnly, bool railwayIngress) =>
        PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        {
            if (!ctx.Request.Path.StartsWithSegments("/api") || snapshotsOnly &&
                (ctx.Request.Path != "/api/spoilers" || ctx.Request.Query.ContainsKey("since")))
                return RateLimitPartition.GetNoLimiter("unmetered");
            return RateLimitPartition.GetFixedWindowLimiter(Client(ctx, railwayIngress), _ =>
                new FixedWindowRateLimiterOptions { PermitLimit = max, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 });
        });

    public static void Configure(IServiceCollection services, IConfiguration config)
    {
        var railway = config.GetValue<bool>("TrustRailwayIngress");
        services.AddSingleton<RequestTotals>();
        services.AddHostedService(sp => sp.GetRequiredService<RequestTotals>());
        services.AddRateLimiter(options =>
        {
            options.GlobalLimiter = PartitionedRateLimiter.CreateChained(
                Quota(Limit(config, "ReadsPerMinute", 60), false, railway),
                Quota(Limit(config, "SnapshotsPerMinute", 10), true, railway));
            options.OnRejected = (ctx, _) =>
            {
                var response = ctx.HttpContext.Response;
                response.StatusCode = StatusCodes.Status429TooManyRequests;
                response.Headers.RetryAfter = "60";
                return ValueTask.CompletedTask;
            };
        });
        services.AddOutputCache(options =>
        {
            options.SizeLimit = 16 * 1024 * 1024;
            options.MaximumBodySize = 4 * 1024 * 1024;
            options.AddPolicy("catalog", p => p.Expire(TimeSpan.FromSeconds(60)).SetVaryByQuery("since"));
        });
    }

    public static void Map(WebApplication app, OfficialWorld world, NpgsqlDataSource pool)
    {
        var totals = app.Services.GetRequiredService<RequestTotals>();
        app.UseWhen(ctx => ctx.Request.Path.StartsWithSegments("/api"), branch => branch.Use(async (ctx, next) =>
        {
            var started = Stopwatch.GetTimestamp();
            try { await next(); }
            catch { totals.Record(500, Stopwatch.GetElapsedTime(started)); throw; }
            totals.Record(ctx.Response.StatusCode, Stopwatch.GetElapsedTime(started));
        }));
        app.UseRateLimiter();
        var concurrency = Limit(app.Configuration, "ConcurrentReads", 32);
        var capacity = new SemaphoreSlim(concurrency, concurrency);
        app.UseWhen(ctx => ctx.Request.Path.StartsWithSegments("/api"), branch => branch.Use(async (ctx, next) =>
        {
            var query = ctx.Request.Query;
            if (query.Count > 0 && (ctx.Request.Path != "/api/spoilers" || query.Count != 1 ||
                !query.TryGetValue("since", out var since) || since.Count != 1 ||
                !long.TryParse(since[0], NumberStyles.None, CultureInfo.InvariantCulture, out _)))
            {
                ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            if (!capacity.Wait(0))
            {
                ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                ctx.Response.Headers.RetryAfter = "1";
                return;
            }
            try { await next(); }
            finally { capacity.Release(); }
        }));
        app.UseOutputCache();
        app.MapGet("/api/world", world.Reference).CacheOutput("catalog");
        app.MapGet("/api/spoilers", (long? since, CancellationToken ct) => Catalog.Read(pool, since, ct)).CacheOutput("catalog");
        app.MapGet("/health/live", () => Results.NoContent());
        var revisionFile = Path.Combine(AppContext.BaseDirectory, "revision.txt");
        var revision = File.Exists(revisionFile) ? File.ReadAllText(revisionFile).Trim() : "development";
        app.MapGet("/health/ready", async (HttpContext ctx, CancellationToken ct) =>
        {
            try
            {
                await using var db = await pool.OpenConnectionAsync(ct);
                await using var command = db.CreateCommand();
                command.CommandTimeout = 3;
                ctx.Response.Headers["X-Catalog-Revision"] = revision;
                command.CommandText = "select model from catalog_model left join (select published from events limit 1) sample on true where id=1";
                return Equals(await command.ExecuteScalarAsync(ct), Rules.Model) ? Results.NoContent() : Results.StatusCode(503);
            }
            catch (NpgsqlException) { return Results.StatusCode(503); }
            catch (TimeoutException) { return Results.StatusCode(503); }
        });
    }
}
