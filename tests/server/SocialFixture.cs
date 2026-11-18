using System.Net;
using System.Net.Http.Json;

sealed class SocialFixture : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        var uri = req.RequestUri!;
        object payload;
        if (uri.Host == "www.googleapis.com")
        {
            if (!req.Headers.Contains("X-Goog-Api-Key")) throw new Exception("Missing fixture API key");
            if (uri.AbsolutePath.EndsWith("/search"))
            {
                payload = new { items = new[] { new { id = new { videoId = "recent" } } } };
            }
            else
            {
                if (!uri.Query.Contains("older-video")) throw new Exception("Older video skipped");
                payload = new { items = new[] { "recent", "older-video" }.Select(id => new
                {
                    id, snippet = new { publishedAt = "2026-01-01T00:00:00Z", title = "GTA VI", description = "edited description", channelId = "author" }
                }) };
            }
        }
        else
        {
            if (req.Headers.Authorization?.Parameter != "fixture") throw new Exception("Missing fixture token");
            string name = uri.AbsolutePath == "/api/info" ? "t3_old" : "t3_recent";
            payload = new { data = new { after = (string?)null, children = new[] { new { data = new
            {
                name, title = "GTA VI", selftext = "An edited report", author = "original",
                created_utc = 1767225600, permalink = "/r/GTA6/comments/" + name
            } } } } };
        }
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(payload) });
    }
}
