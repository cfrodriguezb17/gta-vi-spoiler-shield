using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Xml.Linq;

public interface IDiscovery { Task<List<Document>> Read(Source source, Position cursor, CancellationToken ct); }
public class Connectors(HttpClient http, IConfiguration cfg) : IDiscovery
{
    public Task<List<Document>> Read(Source source, Position cursor, CancellationToken ct) => source.Kind switch
    {
        "feed" => Feed(source, ct),
        "youtube" => YouTube(source, cursor, ct),
        "reddit" => Reddit(source, cursor, ct),
        _ => throw new InvalidDataException("Unknown source kind")
    };
    static string Plain(string value) => WebUtility.HtmlDecode(Regex.Replace(value, "<[^>]{1,2000}>", " ")).Trim();
    static DateTimeOffset Date(string? value) => DateTimeOffset.TryParse(value, out var dt) ? dt.ToUniversalTime() : DateTimeOffset.UnixEpoch;
    async Task<List<Document>> Feed(Source source, CancellationToken ct)
    {
        using var response = await http.GetAsync(source.Url, ct); response.EnsureSuccessStatusCode();
        var xml = XDocument.Parse(await response.Content.ReadAsStringAsync(ct)); var list = new List<Document>();
        foreach (var item in xml.Descendants().Where(e => e.Name.LocalName is "entry" or "item"))
        {
            string? Field(params string[] names) => names.Select(name => item.Elements().FirstOrDefault(e => e.Name.LocalName == name)?.Value).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
            var link = item.Elements().FirstOrDefault(e => e.Name.LocalName == "link" && ((string?)e.Attribute("rel") is null or "alternate"));
            string? url = (string?)link?.Attribute("href") ?? link?.Value;
            if (!Uri.TryCreate(new Uri(source.Url), url, out var uri) || uri.Scheme is not ("https" or "http")) continue;
            var body = Field("encoded", "content", "description", "summary") ?? "";
            var links = Regex.Matches(WebUtility.HtmlDecode(body), """href=["'](https?://[^"']+)""").Select(m => m.Groups[1].Value);
            list.Add(new(Field("id", "guid") ?? uri.AbsoluteUri, uri.AbsoluteUri, Date(Field("published", "pubDate", "updated")), string.Join("\n", new[] { Field("title"), Plain(body) }.Concat(links))));
        }
        return list;
    }
    async Task<JsonNode> Json(HttpRequestMessage req, CancellationToken ct)
    {
        using (req) using (var res = await http.SendAsync(req, ct)) { res.EnsureSuccessStatusCode(); return (await res.Content.ReadFromJsonAsync<JsonNode>(ct))!; }
    }
    async Task<List<Document>> YouTube(Source source, Position cursor, CancellationToken ct)
    {
        var key = cfg["YouTube:Key"];
        if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("Missing YouTube key");
        var list = new List<Document>();
        var videoIds = new HashSet<string>(cursor.Known ?? []);
        string? page = null;
        // Search by publication time; repeat the trailing window to detect description edits.
        var from = (cursor.At ?? DateTimeOffset.UtcNow.AddDays(-5)).AddHours(-24).ToString("yyyy-MM-ddTHH:mm:ssZ");
        do
        {
            var endpoint = source.Url + (source.Url.Contains('?') ? "&" : "?") + "part=snippet&type=video&order=date&maxResults=50&publishedAfter=" + from;
            if (page != null) endpoint += "&pageToken=" + Uri.EscapeDataString(page);
            var req = new HttpRequestMessage(HttpMethod.Get, endpoint);
            req.Headers.Add("X-Goog-Api-Key", key);
            var data = await Json(req, ct);
            foreach (var item in data["items"]!.AsArray())
                if ((string?)item?["id"]?["videoId"] is string id) videoIds.Add(id);
            page = (string?)data["nextPageToken"];
        } while (page != null);
        foreach (var batch in videoIds.Chunk(50))
        {
            var detail = new HttpRequestMessage(HttpMethod.Get, "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" + Uri.EscapeDataString(string.Join(",", batch)));
            detail.Headers.Add("X-Goog-Api-Key", key);
            var rows = await Json(detail, ct);
            foreach (var item in rows["items"]!.AsArray())
            {
                var snippet = item!["snippet"]!;
                string id = (string)item["id"]!;
                list.Add(new(id, "https://www.youtube.com/watch?v=" + id, Date((string?)snippet["publishedAt"]),
                    (string?)snippet["title"] + "\n" + (string?)snippet["description"], "youtube:" + (string?)snippet["channelId"]));
            }
        }
        return list;
    }
    async Task<List<Document>> Reddit(Source source, Position cursor, CancellationToken ct)
    {
        string token = cfg["Reddit:Token"] ?? await AppToken(ct);
        var list = new List<Document>(); string? after = null;
        async Task<JsonNode> Listing(string url)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            var result = (await Json(req, ct))["data"]!;
            foreach (var child in result["children"]!.AsArray())
            {
                var post = child!["data"]!; string link = "https://www.reddit.com" + (string?)post["permalink"];
                string body = (string?)post["title"] + "\n" + (string?)post["selftext"];
                string? target = (string?)post["url_overridden_by_dest"];
                if (target != null) body += "\n" + target;
                var author = (string?)post["author"];
                list.Add(new((string)post["name"]!, link, DateTimeOffset.FromUnixTimeSeconds((long)(double)post["created_utc"]!), body,
                    target != null && Uri.TryCreate(target, UriKind.Absolute, out var uri) ? uri.IdnHost.Replace("www.", "") : author is null or "[deleted]" ? "unattributed-report" : "reddit:" + author));
            }
            return result;
        }
        do
        {
            var page = await Listing(source.Url + "?raw_json=1&limit=100&after=" + Uri.EscapeDataString(after ?? ""));
            after = (string?)page["after"];
        } while (after != null && list.Count > 0 && list[^1].Published > (cursor.At ?? DateTimeOffset.UtcNow.AddDays(-5)).AddHours(-24));
        var older = (cursor.Known ?? []).Except(list.Select(post => post.Reference)).ToArray();
        foreach (var batch in older.Chunk(100))
            await Listing("https://oauth.reddit.com/api/info?raw_json=1&id=" + Uri.EscapeDataString(string.Join(",", batch)));
        return list;
    }
    async Task<string> AppToken(CancellationToken ct)
    {
        var id = cfg["Reddit:ClientId"];
        var secret = cfg["Reddit:ClientSecret"];
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException("Missing Reddit credentials");
        var req = new HttpRequestMessage(HttpMethod.Post, "https://www.reddit.com/api/v1/access_token");
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(id + ":" + secret)));
        req.Content = new FormUrlEncodedContent(new Dictionary<string, string> { { "grant_type", "client_credentials" } });
        return (string)(await Json(req, ct))["access_token"]!;
    }
}
