// EventBridge-scheduled Lambda that kicks off a flow run via InvokeFlow. The flow
// itself fans out to the analyzer agents, synthesizes, and dispatches the report, so
// this handler only needs to start the run and drain the response stream.
import {
  BedrockAgentRuntimeClient,
  InvokeFlowCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  BedrockAgentClient,
  ListFlowsCommand,
  ListFlowAliasesCommand,
} from "@aws-sdk/client-bedrock-agent";
import { logger } from "../lib/logger.js";

const client = new BedrockAgentRuntimeClient({});
const controlClient = new BedrockAgentClient({});

const FLOW_NAME = process.env.FLOW_NAME ?? "";
const FLOW_ALIAS_NAME = process.env.FLOW_ALIAS_NAME ?? "live";
const WINDOW_MINUTES = Number(process.env.WINDOW_MINUTES ?? "60");
const INPUT_NODE = process.env.FLOW_INPUT_NODE ?? "FlowInput";

// Cache resolved ids across warm invocations.
let cachedFlowId: string | undefined;
let cachedAliasId: string | undefined;

interface TriggerDetail {
  windowMinutes?: number;
}

/** Resolve the flow id from its name (the env can't reference the flow without a cycle). */
async function resolveFlowId(): Promise<string> {
  if (cachedFlowId) return cachedFlowId;
  let nextToken: string | undefined;
  do {
    const res = await controlClient.send(new ListFlowsCommand({ nextToken }));
    const match = (res.flowSummaries ?? []).find((f) => f.name === FLOW_NAME);
    if (match?.id) {
      cachedFlowId = match.id;
      return cachedFlowId;
    }
    nextToken = res.nextToken;
  } while (nextToken);
  throw new Error(`No flow named '${FLOW_NAME}' found`);
}

/** Resolve the flow alias id from its name. */
async function resolveAliasId(flowId: string): Promise<string> {
  if (cachedAliasId) return cachedAliasId;
  let nextToken: string | undefined;
  do {
    const res = await controlClient.send(
      new ListFlowAliasesCommand({ flowIdentifier: flowId, nextToken }),
    );
    const match = (res.flowAliasSummaries ?? []).find((a) => a.name === FLOW_ALIAS_NAME);
    if (match?.id) {
      cachedAliasId = match.id;
      return cachedAliasId;
    }
    nextToken = res.nextToken;
  } while (nextToken);
  throw new Error(`No flow alias named '${FLOW_ALIAS_NAME}' found for flow ${flowId}`);
}

export async function handler(event: TriggerDetail = {}) {
  if (!FLOW_NAME) throw new Error("FLOW_NAME must be configured.");
  const windowMinutes = Number(event.windowMinutes) || WINDOW_MINUTES;
  const flowId = await resolveFlowId();
  const flowAliasId = await resolveAliasId(flowId);
  logger.info("flow-trigger starting flow run", { flowId, flowAliasId, windowMinutes });

  // FlowInput emits a String the analyzer agents consume as their instruction.
  const instruction =
    `Analyze the last ${windowMinutes} minutes of telemetry for your source ` +
    `and return the SourceFindings JSON described in your instructions.`;

  const res = await client.send(
    new InvokeFlowCommand({
      flowIdentifier: flowId,
      flowAliasIdentifier: flowAliasId,
      inputs: [
        {
          nodeName: INPUT_NODE,
          nodeOutputName: "document",
          content: { document: instruction },
        },
      ],
    }),
  );

  // Drain the async event stream so the flow runs to completion before we return.
  let finalOutput: unknown;
  let completed = false;
  if (res.responseStream) {
    for await (const evt of res.responseStream) {
      if (evt.flowOutputEvent) finalOutput = evt.flowOutputEvent.content?.document;
      if (evt.flowCompletionEvent) {
        completed = evt.flowCompletionEvent.completionReason === "SUCCESS";
      }
    }
  }

  logger.info("flow-trigger completed", { completed });
  return { started: true, completed, windowMinutes, output: finalOutput ?? null };
}
