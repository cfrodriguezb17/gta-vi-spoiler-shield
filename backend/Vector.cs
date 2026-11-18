using System.Globalization;
using System.Text.Json;
using Npgsql;
public interface IVectorStore
{
    Task<float[]> Embed(string text, CancellationToken ct);
    Task<List<Hit>> Nearest(NpgsqlConnection db, float[] embedding, CancellationToken ct);
}
public class VectorStore(HttpClient http, IConfiguration config) : IVectorStore
{
    public static string Literal(float[] v) => "[" + string.Join(",", v.Select(x => x.ToString("R", CultureInfo.InvariantCulture))) + "]";
    public async Task<float[]> Embed(string text, CancellationToken ct)
    {
        using var response = await http.PostAsJsonAsync(config["EncoderUrl"] ?? "http://127.0.0.1:5072/embed", new { text }, ct);
        response.EnsureSuccessStatusCode(); var item = await response.Content.ReadFromJsonAsync<Embedding>(ct);
        if (item?.ModelVersion != Rules.Model || item.Vector.Length != 384 || !item.Vector.All(float.IsFinite)) throw new InvalidDataException("Incompatible encoder");
        return item.Vector;
    }
    record Embedding(string ModelVersion, float[] Vector);
    public Task<List<Hit>> Nearest(NpgsqlConnection db, float[] vec, CancellationToken ct)
    {
        bool exact = config.GetValue<bool>("ExactVectors");
        string order = exact ? "(select -sum(a*b) from unnest(embedding,$1::real[]) as t(a,b))" : "embedding <=> $1::vector";
        return db.Rows("select id,fact::text from events order by " + order + " limit 32", r => new Hit(r.GetGuid(0), JsonSerializer.Deserialize<Fact>(r.GetString(1), Rules.Json)!), ct, exact ? (object)vec : Literal(vec));
    }
}
