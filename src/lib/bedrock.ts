// Helpers for the Bedrock Agent <-> Lambda "action group" contract (OpenAPI schema
// mode). The agent invokes the Lambda with parameters + a JSON request body; the
// Lambda must reply in a specific envelope. These helpers hide that envelope so the
// handlers can deal in plain inputs and outputs.

/** Parameter as delivered by Bedrock (query/path params and body properties). */
interface BedrockParameter {
  name: string;
  type: string;
  value: string;
}

/** The event a Bedrock Agent sends to an action-group Lambda. */
export interface ActionGroupEvent {
  messageVersion: string;
  agent: { name: string; id: string; alias: string; version: string };
  inputText?: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters?: BedrockParameter[];
  requestBody?: {
    content?: Record<string, { properties?: BedrockParameter[] }>;
  };
  sessionAttributes?: Record<string, string>;
  promptSessionAttributes?: Record<string, string>;
}

export interface ActionGroupResponse {
  messageVersion: "1.0";
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: { "application/json": { body: string } };
  };
  sessionAttributes?: Record<string, string>;
  promptSessionAttributes?: Record<string, string>;
}

/**
 * Flatten an action-group event into a single record of inputs, merging path/query
 * parameters with JSON request-body properties. Values arrive as strings; callers
 * coerce as needed via the typed accessors below.
 */
export function collectInputs(event: ActionGroupEvent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of event.parameters ?? []) out[p.name] = p.value;
  const props = event.requestBody?.content?.["application/json"]?.properties ?? [];
  for (const p of props) out[p.name] = p.value;
  return out;
}

export function getString(
  inputs: Record<string, string>,
  key: string,
  fallback?: string,
): string | undefined {
  const v = inputs[key];
  return v === undefined || v === "" ? fallback : v;
}

export function getNumber(
  inputs: Record<string, string>,
  key: string,
  fallback: number,
): number {
  const v = inputs[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Build the success envelope Bedrock expects, with a JSON-stringified body. */
export function buildResponse(
  event: ActionGroupEvent,
  body: unknown,
  httpStatusCode = 200,
): ActionGroupResponse {
  return {
    messageVersion: "1.0",
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode,
      responseBody: { "application/json": { body: JSON.stringify(body) } },
    },
    sessionAttributes: event.sessionAttributes,
    promptSessionAttributes: event.promptSessionAttributes,
  };
}

/**
 * Build an error result the *model* should handle, not the agent runtime.
 *
 * IMPORTANT: this returns HTTP 200 with the error in the body. Bedrock Agents treats
 * a non-2xx `httpStatusCode` in the action-group response as a failed dependency and
 * aborts the agent (surfacing as a 424 to a calling flow). Returning 200 lets the
 * model read `{ error, isError }` and respond gracefully (e.g. healthy:false).
 */
export function buildError(event: ActionGroupEvent, message: string): ActionGroupResponse {
  return buildResponse(event, { error: message, isError: true }, 200);
}
