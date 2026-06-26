// Canonical description of the Bedrock Flow graph, in the shape the Bedrock
// `CreateFlow` API expects.
//
// The deploy path is Terraform (`infra/flow.tf` defines the same graph via the
// `aws_bedrockagent_flow` resource; `scripts/publish-flow.mjs` publishes its version
// and alias). This module documents the topology in one typed place and is exercised
// by `test/flow.test.ts`, which checks the graph is internally consistent. Keep it in
// sync with `infra/flow.tf` when changing the topology.

export interface FlowBuildInput {
  /** Map of source -> Bedrock agent alias ARN. */
  agentAliasArns: {
    cloudwatch: string;
    splunk: string;
    generic: string;
    emailAlert: string;
  };
  /** Report-dispatcher Lambda ARN (the flow's terminal Lambda node). */
  dispatcherLambdaArn: string;
  /** Foundation model id/ARN for the inline synthesis prompt node. */
  synthesisModelArn: string;
  /** The synthesis prompt text (from prompts/orchestrator-synthesis.md). */
  synthesisPromptText: string;
}

/**
 * Build the Bedrock Flow definition object (nodes + connections).
 *
 * Topology: FlowInput -> [4 analyzer agents in parallel] -> Synthesis prompt
 *           -> ReportDispatcher Lambda -> FlowOutput.
 */
export function buildFlowDefinition(input: FlowBuildInput) {
  const agentNode = (name: string, agentAliasArn: string) => ({
    name,
    type: "Agent",
    configuration: { agent: { agentAliasArn } },
    inputs: [
      {
        name: "agentInputText",
        type: "String",
        // Each agent consumes the instruction string emitted by FlowInput.
        expression: "$.data",
      },
    ],
    outputs: [{ name: "agentResponse", type: "String" }],
  });

  const nodes = [
    {
      name: "FlowInput",
      type: "Input",
      configuration: { input: {} },
      // The trigger sends a ready-made instruction string as the document.
      outputs: [{ name: "document", type: "String" }],
    },
    agentNode("CloudWatchAgent", input.agentAliasArns.cloudwatch),
    agentNode("SplunkAgent", input.agentAliasArns.splunk),
    agentNode("GenericAgent", input.agentAliasArns.generic),
    agentNode("EmailAlertAgent", input.agentAliasArns.emailAlert),
    {
      name: "Synthesis",
      type: "Prompt",
      configuration: {
        prompt: {
          sourceConfiguration: {
            inline: {
              modelId: input.synthesisModelArn,
              templateType: "TEXT",
              inferenceConfiguration: { text: { maxTokens: 4096, temperature: 0 } },
              templateConfiguration: {
                text: {
                  text: input.synthesisPromptText,
                  inputVariables: [
                    { name: "cloudwatch" },
                    { name: "splunk" },
                    { name: "generic" },
                    { name: "emailAlert" },
                  ],
                },
              },
            },
          },
        },
      },
      inputs: [
        { name: "cloudwatch", type: "String", expression: "$.data" },
        { name: "splunk", type: "String", expression: "$.data" },
        { name: "generic", type: "String", expression: "$.data" },
        { name: "emailAlert", type: "String", expression: "$.data" },
      ],
      outputs: [{ name: "modelCompletion", type: "String" }],
    },
    {
      name: "ReportDispatcher",
      type: "LambdaFunction",
      configuration: { lambdaFunction: { lambdaArn: input.dispatcherLambdaArn } },
      inputs: [{ name: "report", type: "String", expression: "$.data" }],
      outputs: [{ name: "functionResponse", type: "Object" }],
    },
    {
      name: "FlowOutput",
      type: "Output",
      configuration: { output: {} },
      inputs: [{ name: "document", type: "Object", expression: "$.data" }],
    },
  ];

  const dataConn = (from: string, fromOut: string, to: string, toIn: string) => ({
    name: `${from}_to_${to}`,
    source: from,
    target: to,
    type: "Data",
    configuration: {
      data: { sourceOutput: `${from}.${fromOut}`, targetInput: `${to}.${toIn}` },
    },
  });

  const connections = [
    dataConn("FlowInput", "document", "CloudWatchAgent", "agentInputText"),
    dataConn("FlowInput", "document", "SplunkAgent", "agentInputText"),
    dataConn("FlowInput", "document", "GenericAgent", "agentInputText"),
    dataConn("FlowInput", "document", "EmailAlertAgent", "agentInputText"),
    dataConn("CloudWatchAgent", "agentResponse", "Synthesis", "cloudwatch"),
    dataConn("SplunkAgent", "agentResponse", "Synthesis", "splunk"),
    dataConn("GenericAgent", "agentResponse", "Synthesis", "generic"),
    dataConn("EmailAlertAgent", "agentResponse", "Synthesis", "emailAlert"),
    dataConn("Synthesis", "modelCompletion", "ReportDispatcher", "report"),
    dataConn("ReportDispatcher", "functionResponse", "FlowOutput", "document"),
  ];

  return { nodes, connections };
}
