using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

public record Person(string Name, string Role, string[] Aliases);
public record Fact(string Description, string Action, string[] Forms, Person[] Participants, int? Mission, int Severity, bool Negated, string Passage, bool Direct, string Origin);
public record Source(string Id, string Kind, string Url, string Trust = "community", string? Origin = null, bool FilterGame = false);
public record Document(string Reference, string Url, DateTimeOffset Published, string Body, string? Origin = null);
public record Position(DateTimeOffset? At, string? Reference, string[]? Known = null);
public record Hit(Guid Id, Fact Fact);
public record Batch(long Version, string ModelVersion, JsonNode[] Added, JsonNode[] Updated, Guid[] Deleted);
public static class Rules
{
    public const string Model = "vi-lex-es-en-384-v1";
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static int Slot(DateTimeOffset start, DateTimeOffset now) => (int)Math.Floor((now - start).TotalHours);
    public static string State(int origins, bool directReliable, bool officialReference) => officialReference || origins >= 2 && directReliable ? "confirmed" : directReliable || origins >= 2 ? "probable" : "candidate";
    public static string Norm(string s) => string.Join(" ", s.Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    public static int IndependentOrigins(IEnumerable<(string Origin, string Passage)> evidence)
    {
        var groups = new List<HashSet<string>>();
        foreach (var (origin, passage) in evidence)
        {
            if (origin == "unattributed-report") continue;
            var group = new HashSet<string> { "origin:" + origin, "quote:" + Hash(Norm(passage)) };
            for (int i = groups.Count - 1; i >= 0; i--)
            {
                if (!group.Overlaps(groups[i])) continue;
                group.UnionWith(groups[i]);
                groups.RemoveAt(i);
            }
            groups.Add(group);
        }
        return groups.Count;
    }
    public static bool Supported(Fact? f, string body) => f != null && !string.IsNullOrWhiteSpace(f.Description) && !string.IsNullOrWhiteSpace(f.Action) &&
        !string.IsNullOrWhiteSpace(f.Passage) && body.Contains(f.Passage, StringComparison.Ordinal) && f.Mission is not <= 0 && f.Severity is >= 1 and <= 5 &&
        f.Forms != null && f.Forms.All(x => !string.IsNullOrWhiteSpace(x)) && f.Participants is { Length: > 0 } &&
        f.Participants.All(p => p != null && !string.IsNullOrWhiteSpace(p.Name) && p.Role is "actor" or "target" or "participant" && p.Aliases != null && p.Aliases.All(a => !string.IsNullOrWhiteSpace(a)));
    public static string Origin(Source source, Document doc, Fact fact)
    {
        // Only accept an attributed URL that actually occurs in the material.
        if (!string.IsNullOrWhiteSpace(fact.Origin) && doc.Body.Contains(fact.Origin, StringComparison.Ordinal) && Uri.TryCreate(fact.Origin, UriKind.Absolute, out var upstream))
            return Host(upstream);
        if (!fact.Direct) return "unattributed-report";
        if (source.Origin != null) return source.Origin;
        if (doc.Origin != null) return doc.Origin;
        return Host(new Uri(doc.Url));
    }
    static string Host(Uri u) => u.IdnHost.Replace("www.", "", StringComparison.OrdinalIgnoreCase).ToLowerInvariant();
}
public static class Sql
{
    public static NpgsqlCommand Query(this NpgsqlConnection db, string sql, params object?[] values)
    {
        var cmd = new NpgsqlCommand(sql, db);
        foreach (var value in values) cmd.Parameters.Add(new NpgsqlParameter { Value = value ?? DBNull.Value });
        return cmd;
    }
    public static async Task Exec(this NpgsqlConnection db, string sql, CancellationToken ct, params object?[] args)
    {
        await using var cmd = db.Query(sql, args); await cmd.ExecuteNonQueryAsync(ct);
    }
    public static async Task<T> Scalar<T>(this NpgsqlConnection db, string sql, CancellationToken ct, params object?[] args)
    {
        await using var cmd = db.Query(sql, args); var result = await cmd.ExecuteScalarAsync(ct);
        return result is null or DBNull ? default! : (T)result;
    }
    public static async Task<List<T>> Rows<T>(this NpgsqlConnection db, string sql, Func<NpgsqlDataReader, T> map, CancellationToken ct, params object?[] args)
    {
        await using var cmd = db.Query(sql, args); await using var reader = await cmd.ExecuteReaderAsync(ct);
        var list = new List<T>(); while (await reader.ReadAsync(ct)) list.Add(map(reader)); return list;
    }
}
