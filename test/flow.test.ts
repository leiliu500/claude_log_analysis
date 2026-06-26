import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlowDefinition } from "../src/flow/definition.ts";

const def = buildFlowDefinition({
  agentAliasArns: {
    cloudwatch: "arn:aws:bedrock:us-east-1:111:agent-alias/A/cw",
    splunk: "arn:aws:bedrock:us-east-1:111:agent-alias/A/sp",
    generic: "arn:aws:bedrock:us-east-1:111:agent-alias/A/gn",
    emailAlert: "arn:aws:bedrock:us-east-1:111:agent-alias/A/em",
  },
  dispatcherLambdaArn: "arn:aws:lambda:us-east-1:111:function:dispatch",
  synthesisModelArn: "us.anthropic.claude-sonnet-4-6",
  synthesisPromptText: "synthesize {{cloudwatch}} {{splunk}} {{generic}} {{emailAlert}}",
});

test("graph has the expected nodes", () => {
  const names = def.nodes.map((n) => n.name).sort();
  assert.deepEqual(names, [
    "CloudWatchAgent",
    "EmailAlertAgent",
    "FlowInput",
    "FlowOutput",
    "GenericAgent",
    "ReportDispatcher",
    "SplunkAgent",
    "Synthesis",
  ]);
});

test("every connection references existing nodes and their ports", () => {
  const byName = new Map(def.nodes.map((n) => [n.name, n]));
  for (const c of def.connections) {
    const source = byName.get(c.source);
    const target = byName.get(c.target);
    assert.ok(source, `unknown source node ${c.source}`);
    assert.ok(target, `unknown target node ${c.target}`);

    const [srcNode, srcPort] = c.configuration.data.sourceOutput.split(".");
    const [tgtNode, tgtPort] = c.configuration.data.targetInput.split(".");
    assert.equal(srcNode, c.source);
    assert.equal(tgtNode, c.target);

    const hasOutput = (source as { outputs?: Array<{ name: string }> }).outputs?.some(
      (o) => o.name === srcPort,
    );
    const hasInput = (target as { inputs?: Array<{ name: string }> }).inputs?.some(
      (i) => i.name === tgtPort,
    );
    assert.ok(hasOutput, `${c.source} has no output ${srcPort}`);
    assert.ok(hasInput, `${c.target} has no input ${tgtPort}`);
  }
});

test("synthesis fans in from all four agents", () => {
  const intoSynthesis = def.connections.filter((c) => c.target === "Synthesis");
  assert.equal(intoSynthesis.length, 4);
});
