using System.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

public class Catalog(IVectorStore vectors, IConfiguration config)
{
    public async Task Store(NpgsqlConnection db, Source source, Document doc, string hash, List<Fact> facts, DateTimeOffset now, CancellationToken ct)
    {
        if (facts.Any(f => !Rules.Supported(f, doc.Body))) throw new InvalidDataException("Extraction contains an unsupported claim");
        var prepared = new List<(Fact Fact, float[] Vector)>();
        foreach (var fact in facts) prepared.Add((fact, await vectors.Embed(fact.Description, ct)));
        await using var tx = await db.BeginTransactionAsync(ct);
        var id = await db.Scalar<long>(@"insert into documents(source,reference,url,published,hash,modified) values($1,$2,$3,$4,$5,$6)
            on conflict(source,reference) do update set url=excluded.url,published=excluded.published,hash=excluded.hash,modified=excluded.modified
            where documents.hash<>excluded.hash returning id", ct, source.Id, doc.Reference, doc.Url, doc.Published.UtcDateTime, hash, now.UtcDateTime);
        if (id == 0) { await tx.CommitAsync(ct); return; }
        long revision = await db.Scalar<long>("insert into revisions(document,hash,observed,body) values($1,$2,$3,$4) returning id", ct, id, hash, now.UtcDateTime, doc.Body);
        var affected = (await db.Rows("delete from evidence where document=$1 returning event", r => r.GetGuid(0), ct, id)).ToHashSet();
        foreach (var (fact, vector) in prepared)
        {
            var participants = new List<(long Id, string Role)>();
            foreach (var p in fact.Participants)
            {
                string[] names = p.Aliases.Prepend(p.Name).Select(Rules.Norm).Distinct().ToArray();
                var entity = await db.Scalar<long>("select entity from aliases where alias=any($1) order by (alias=$2) desc,entity limit 1", ct, names, names[0]);
                if (entity == 0) entity = await db.Scalar<long>("insert into entities(name) values($1) returning id", ct, p.Name);
                await db.Exec("insert into aliases(alias,entity) select unnest($1::text[]),$2 on conflict do nothing", ct, names, entity);
                participants.Add((entity, p.Role));
            }
            var roles = participants.Distinct().OrderBy(p => p.Id).ThenBy(p => p.Role).ToArray();
            string signature = Rules.Hash(JsonSerializer.Serialize(new { roles = roles.Select(p => new { p.Id, p.Role }), action = Rules.Norm(fact.Action), fact.Negated, fact.Mission }));
            Guid eid = await db.Scalar<Guid>("select id from events where signature=$1", ct, signature);
            if (eid == Guid.Empty)
            {
                foreach (var hit in await vectors.Nearest(db, vector, ct))
                {
                    var other = hit.Fact;
                    if (other.Mission != fact.Mission || other.Negated != fact.Negated ||
                        !other.Forms.Append(other.Action).Select(Rules.Norm).Intersect(fact.Forms.Append(fact.Action).Select(Rules.Norm)).Any()) continue;
                    var found = await db.Rows("select entity,role from participants where event=$1 order by entity,role", r => (r.GetInt64(0), r.GetString(1)), ct, hit.Id);
                    if (found.SequenceEqual(roles)) { eid = hit.Id; break; }
                }
            }
            string payload = JsonSerializer.Serialize(fact, Rules.Json);
            if (eid == Guid.Empty)
            {
                eid = Guid.NewGuid();
                if (fact.Mission.HasValue) await db.Exec("insert into missions values($1) on conflict do nothing", ct, fact.Mission);
                bool exact = config.GetValue<bool>("ExactVectors");
                await db.Exec("insert into events(id,signature,fact,mission,embedding) values($1,$2,$3::jsonb,$4,$5::" + (exact ? "real[]" : "vector") + ")", ct, eid, signature, payload, fact.Mission, exact ? (object)vector : VectorStore.Literal(vector));
                foreach (var p in roles) await db.Exec("insert into participants values($1,$2,$3)", ct, eid, p.Id, p.Role);
            }
            await db.Exec(@"insert into evidence(document,event,revision,origin,direct,reliable,official,passage,fact)
                values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict(document,event) do nothing",
                ct, id, eid, revision, Rules.Origin(source, doc, fact), fact.Direct && string.IsNullOrWhiteSpace(fact.Origin), source.Trust is "official" or "editorial" or "guide", source.Trust == "official", fact.Passage, payload);
            affected.Add(eid);
        }
        foreach (var eid in affected) await Publish(db, eid, ct);
        await tx.CommitAsync(ct);
    }
    static async Task Publish(NpgsqlConnection db, Guid id, CancellationToken ct)
    {
        var data = await db.Rows("select origin,direct,reliable,official,fact::text from evidence where event=$1 order by official desc,(direct and reliable) desc,document", r =>
            new { origin = r.GetString(0), direct = r.GetBoolean(1), reliable = r.GetBoolean(2), official = r.GetBoolean(3), fact = JsonSerializer.Deserialize<Fact>(r.GetString(4), Rules.Json)! }, ct, id);
        var independent = Rules.IndependentOrigins(data.Select(d => (d.origin, d.fact.Passage)));
        var state = data.Count == 0 ? "withdrawn" : Rules.State(independent, data.Any(d => d.direct && d.reliable), data.Any(d => d.direct && d.official));
        string? payload = null;
        if (state is "probable" or "confirmed")
        {
            var f = data[0].fact;
            // Publish translations and aliases only from currently active evidence.
            var people = await db.Rows("select e.name,p.role,array_agg(a.alias order by a.alias) from participants p join entities e on e.id=p.entity join aliases a on a.entity=e.id where p.event=$1 group by e.id,p.role order by e.id,p.role",
                r => new Person(r.GetString(0), r.GetString(1), r.GetFieldValue<string[]>(2)), ct, id);
            string raw = await db.Scalar<string>("select embedding::text from events where id=$1", ct, id);
            var vector = JsonSerializer.Deserialize<float[]>(raw.Replace('{', '[').Replace('}', ']'));
            payload = JsonSerializer.Serialize(new
            {
                id,
                f.Description,
                f.Action,
                forms = data.SelectMany(d => d.fact.Forms.Append(d.fact.Action)).Distinct().Order(),
                participants = people,
                f.Negated,
                f.Mission,
                severity = data.Max(d => d.fact.Severity),
                confidence = state == "confirmed" ? 0.95 : 0.75,
                status = state,
                vector
            }, Rules.Json);
        }
        await db.Exec(@"insert into changes(event,was_visible,payload) select id,published is not null,$2::jsonb from events
            where id=$1 and published is distinct from $2::jsonb", ct, id, payload);
        await db.Exec("update events set status=$2,published=$3::jsonb where id=$1", ct, id, state, payload);
    }
    public static async Task<IResult> Read(NpgsqlDataSource pool, long? since, CancellationToken ct)
    {
        if (since is < 0) return Results.BadRequest();
        await using var db = await pool.OpenConnectionAsync(ct);
        await using var tx = await db.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        long version = await db.Scalar<long>("select coalesce(max(version),0) from changes", ct);
        if (since > version || since < version - 10000) return Results.StatusCode(410);
        JsonNode[] added, updated = []; Guid[] deleted = [];
        if (since == null) added = (await db.Rows("select published::text from events where published is not null order by id", r => JsonNode.Parse(r.GetString(0))!, ct)).ToArray();
        else
        {
            var diffs = await db.Rows(@"select distinct on(event) event,first_value(was_visible) over(partition by event order by version),payload::text
                from changes where version>$1 order by event,version desc", r => new { id = r.GetGuid(0), before = r.GetBoolean(1), item = r.IsDBNull(2) ? null : JsonNode.Parse(r.GetString(2)) }, ct, since);
            added = diffs.Where(x => !x.before && x.item != null).Select(x => x.item!).ToArray();
            updated = diffs.Where(x => x.before && x.item != null).Select(x => x.item!).ToArray();
            deleted = diffs.Where(x => x.before && x.item == null).Select(x => x.id).ToArray();
        }
        await tx.CommitAsync(ct);
        return Results.Ok(new Batch(version, Rules.Model, added, updated, deleted));
    }
}
