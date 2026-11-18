// Run once after creating the services or when their settings change.
// Uses the operator's linked Railway account; no credentials are written to disk.
const [project, environment] = process.argv.slice(2);
if (!project || !["staging", "production"].includes(environment))
  throw Error("Usage: bun ops/configure-railway.ts PROJECT_ID staging|production");
async function railway(args: string[]) {
  const proc = Bun.spawn(["bunx", "--package", "@railway/cli@5.75.0", "railway", ...args],
    { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(proc.stdout).text();
  if (await proc.exited !== 0) throw Error("Railway command failed");
  return JSON.parse(output);
}
const projectQuery = `query($id:String!){project(id:$id){environments{edges{node{id name}}}}}`;
const result = await railway(["api", projectQuery, "--var", "id=" + project]);
const environmentId = result.data.project.environments.edges.find((e: any) => e.node.name === environment)?.node.id;
if (!environmentId) throw Error("Environment missing");
const services = await railway(["service", "list", "--project", project, "--environment", environmentId, "--json"]);
const settings = {
  migrate: { preDeployCommand: ["dotnet Shield.dll migrate"], startCommand: "/bin/true", restartPolicyType: "NEVER" },
  encoder: { restartPolicyType: "ON_FAILURE", numReplicas: 1 },
  api: { restartPolicyType: "ON_FAILURE", numReplicas: 1, sleepApplication: false,
    healthcheckPath: "/health/ready", healthcheckTimeout: 60 },
};
const query = `mutation($serviceId:String!, $environmentId:String!, $input:ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId:$serviceId, environmentId:$environmentId, input:$input)
}`;
for (const [name, input] of Object.entries(settings)) {
  const service = services.find((s: any) => s.name === name);
  if (!service) throw Error("Provision service " + name + " in " + environment);
  const variables = JSON.stringify({ serviceId: service.id, environmentId, input });
  const updated = await railway(["api", query, "--variables", variables]);
  if (!updated.data.serviceInstanceUpdate) throw Error("Update failed for " + name);
  console.log("Configured " + name + " in " + environment);
}
