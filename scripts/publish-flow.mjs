// Publishes a Bedrock Flow version and upserts a named alias pointing at it.
// Invoked by Terraform (terraform_data.publish_flow) because the AWS provider
// manages the flow but not its versions/aliases.
//
// Usage: node publish-flow.mjs <flowId> <region> <aliasName>
import {
  BedrockAgentClient,
  PrepareFlowCommand,
  GetFlowCommand,
  CreateFlowVersionCommand,
  ListFlowAliasesCommand,
  CreateFlowAliasCommand,
  UpdateFlowAliasCommand,
} from "@aws-sdk/client-bedrock-agent";

const [, , flowId, region, aliasName = "live"] = process.argv;
if (!flowId || !region) {
  console.error("Usage: node publish-flow.mjs <flowId> <region> <aliasName>");
  process.exit(1);
}

const client = new BedrockAgentClient({ region });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForStatus(target, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = await client.send(new GetFlowCommand({ flowIdentifier: flowId }));
    if (status === target) return;
    if (status === "Failed") throw new Error(`Flow ${flowId} entered Failed state`);
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for flow ${flowId} to reach ${target}`);
}

async function main() {
  console.log(`Preparing flow ${flowId}...`);
  await client.send(new PrepareFlowCommand({ flowIdentifier: flowId }));
  await waitForStatus("Prepared");

  console.log("Creating flow version...");
  const { version } = await client.send(
    new CreateFlowVersionCommand({ flowIdentifier: flowId }),
  );
  console.log(`Published version ${version}`);

  const routingConfiguration = [{ flowVersion: version }];

  const { flowAliasSummaries = [] } = await client.send(
    new ListFlowAliasesCommand({ flowIdentifier: flowId }),
  );
  const existing = flowAliasSummaries.find((a) => a.name === aliasName);

  if (existing) {
    console.log(`Updating alias '${aliasName}' (${existing.id}) -> v${version}`);
    await client.send(
      new UpdateFlowAliasCommand({
        flowIdentifier: flowId,
        aliasIdentifier: existing.id,
        name: aliasName,
        routingConfiguration,
      }),
    );
  } else {
    console.log(`Creating alias '${aliasName}' -> v${version}`);
    await client.send(
      new CreateFlowAliasCommand({
        flowIdentifier: flowId,
        name: aliasName,
        routingConfiguration,
      }),
    );
  }
  console.log("Flow alias published.");
}

main().catch((err) => {
  console.error("publish-flow failed:", err.message);
  process.exit(1);
});
