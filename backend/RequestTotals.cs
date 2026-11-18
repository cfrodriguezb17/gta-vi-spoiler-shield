// Emit one aggregate per active minute. No client identifier, cursor or URL is retained.
public sealed class RequestTotals(ILogger<RequestTotals> log) : BackgroundService
{
    private readonly object gate = new();
    private long reads, limited, errors, elapsedTicks;
    public void Record(int status, TimeSpan duration)
    {
        lock (gate)
        {
            reads++;
            if (status == 429) limited++;
            if (status >= 500) errors++;
            elapsedTicks += duration.Ticks;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            lock (gate)
            {
                if (reads == 0) continue;
                log.LogInformation("Catalog reads {Reads}, throttled {Throttled}, server errors {Errors}, mean latency {MeanMs} ms",
                    reads, limited, errors, TimeSpan.FromTicks(elapsedTicks / reads).TotalMilliseconds);
                reads = limited = errors = elapsedTicks = 0;
            }
        }
    }
}
