/**
 * Reading a mocked model request, whichever way it asks for its answer.
 *
 * A model that can be forced gets the schema as a tool. Sonnet 5.5 onward gets
 * it as an output format, with no tool and so no tool name.
 */

/** Loose on purpose, so a test can reach into any depth of a schema. */
interface Schema {
  properties: Record<string, Schema>;
  items: Schema;
  enum: unknown[];
}

export interface ModelRequest {
  tools?: { name: string; input_schema: Schema }[];
  output_config?: { format?: { schema: Schema } };
}

/** The schema the answer must fit. */
export function answerSchema(request: ModelRequest): Schema {
  const schema = request.tools?.[0]?.input_schema ?? request.output_config?.format?.schema;
  if (!schema) throw new Error("The request carries no tool and no output format.");
  return schema;
}

/** Which record the request asks for, named as its tool is. */
export function answerName(request: ModelRequest): string {
  if (request.tools?.[0]) return request.tools[0].name;
  const fields = answerSchema(request).properties;
  if ("clause_review" in fields) return "record_analysis";
  if ("details" in fields) return "record_historical_contract";
  if ("terms" in fields) return "record_contract_terms";
  throw new Error(`No known record has the fields ${Object.keys(fields).join(", ")}.`);
}
