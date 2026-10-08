import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeContract,
  answerRequest,
  draftEvalClauses,
  extractContractTerms,
  forcesTool,
  formatSchema,
  generateClientEmail,
  generatePropertyEmail,
  historicalRequest,
  readAnswer,
  readBackEvalTerms,
  RefusalError,
} from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";

/**
 * How each model is asked for its answer.
 *
 * Sonnet 5 and older are forced to a tool. Sonnet 5.5 rejects a forced
 * tool_choice and disabled thinking, so it gets no tool: the schema goes as an
 * output format, with thinking "between_tools" and a stated effort. An output
 * format must close every object and stay inside the API's complexity limits,
 * or every call 400s.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create, stream: (params: unknown) => ({ finalMessage: () => create(params) }) };
  },
}));

const usage = { input_tokens: 0, output_tokens: 0 };

const jsonResponse = (answer: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(answer) }],
  stop_reason: "end_turn",
  usage,
});

const refusal = { content: [], stop_reason: "refusal", usage };

const NEW = "claude-sonnet-5-5";

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

/** The request each call sends to Sonnet 5.5. */
async function unforcedRequests() {
  create.mockResolvedValue(
    jsonResponse({ clause_review: [], findings: [], subject: "s", body: "b", terms: [], clauses: [], answers: [] })
  );
  await analyzeContract({ document: { kind: "text", text: "C" }, standards: STANDARDS_LIBRARY, standardsVersion: STANDARDS_LIBRARY_VERSION, model: NEW });
  await generateClientEmail({ findings: [], associateName: "A", contractLabel: "L", model: NEW });
  await generatePropertyEmail({ items: [], propertyLabel: "P", model: NEW });
  await extractContractTerms({ document: { kind: "text", text: "C" }, catalog: HOTEL_TERM_CATALOG, model: NEW });
  await draftEvalClauses({ hotel: "H", group: "G", city: "C", state: "S", dates: "D", voice: "terse", clauses: [], model: NEW });
  await readBackEvalTerms({ contractText: "C", questions: [], model: NEW });
  return [
    ...create.mock.calls.map((c) => c[0]),
    historicalRequest({ document: { kind: "text", text: "C" }, catalog: HOTEL_TERM_CATALOG, model: NEW }),
  ];
}

type Schema = Record<string, unknown>;

function walk(schema: unknown, visit: (node: Schema) => void) {
  if (Array.isArray(schema)) return schema.forEach((s) => walk(s, visit));
  if (schema === null || typeof schema !== "object") return;
  visit(schema as Schema);
  for (const [key, value] of Object.entries(schema)) if (key !== "enum" && key !== "required") walk(value, visit);
}

/** Parameters outside `required`, and parameters with a type array or anyOf, across one schema. */
function complexity(schema: unknown) {
  let optional = 0;
  let unions = 0;
  walk(schema, (node) => {
    const props = node.properties as Record<string, Schema> | undefined;
    if (!props) return;
    const required = new Set((node.required as string[] | undefined) ?? []);
    for (const [name, prop] of Object.entries(props)) {
      if (!required.has(name)) optional++;
      if (Array.isArray(prop.type) || prop.anyOf) unions++;
    }
  });
  return { optional, unions };
}

describe("the request shape for each model", () => {
  const tool = { name: "t", description: "Record it.", input_schema: { type: "object" as const, properties: {} } };

  it("forces the tool only for models that accept it", () => {
    expect(forcesTool("claude-sonnet-5")).toBe(true);
    expect(forcesTool("claude-haiku-4-5")).toBe(true);
    expect(forcesTool(NEW)).toBe(false);
    expect(forcesTool("claude-some-future-model")).toBe(false);
  });

  it("leaves a forced model's tool untouched", () => {
    expect(answerRequest("claude-sonnet-5", tool)).toEqual({ tools: [tool], tool_choice: { type: "tool", name: "t" } });
  });

  it("gives Sonnet 5.5 the schema as an output format, with no thinking ahead of the answer", () => {
    expect(answerRequest(NEW, tool)).toEqual({
      thinking: { type: "between_tools" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: { type: "object", properties: {}, additionalProperties: false } },
      },
    });
  });

  it("lets a caller turn thinking on and set the effort, for measuring another setting", () => {
    expect(answerRequest(NEW, tool, { thinking: "adaptive", effort: "low" })).toMatchObject({
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    expect(answerRequest("claude-sonnet-5", tool, { thinking: "adaptive", effort: "low" })).toEqual(answerRequest("claude-sonnet-5", tool));
  });

  it("leaves between_tools off any other unforced model, which would reject it", () => {
    expect(answerRequest("claude-some-future-model", tool)).not.toHaveProperty("thinking");
  });

  it("closes every object, including nullable ones, and leaves enums and required lists alone", () => {
    const closed = formatSchema({
      type: "object",
      properties: {
        a: { type: ["object", "null"], properties: { b: { type: "string", enum: ["object"] } }, required: ["b"] },
        c: { type: "array", items: { type: "object", properties: {} } },
      },
    });
    expect(closed).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        a: { type: ["object", "null"], additionalProperties: false, properties: { b: { type: "string", enum: ["object"] } }, required: ["b"] },
        c: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } },
      },
    });
  });

  it("writes a nullable enum as anyOf, which an output format accepts where an enum beside two types is refused", () => {
    expect(formatSchema({ type: ["string", "null"], enum: ["luxury", "resort", null], description: "The tier." })).toEqual({
      description: "The tier.",
      anyOf: [{ type: "string", enum: ["luxury", "resort"] }, { type: "null" }],
    });
  });
});

describe("Sonnet 5.5 requests", () => {
  it("cover all seven calls", async () => {
    expect(await unforcedRequests()).toHaveLength(7);
  });

  it("carry no tool, state thinking and effort, and say the reply is the record", async () => {
    const [judging, ...others] = await unforcedRequests();

    // The judging call may think, at medium effort. Every other call skips thinking at high.
    expect(judging.thinking).toEqual({ type: "adaptive" });
    expect(judging.output_config.effort).toBe("medium");
    for (const params of others) {
      expect(params.thinking).toEqual({ type: "between_tools" });
      expect(params.output_config.effort).toBe("high");
    }

    for (const params of [judging, ...others]) {
      expect(params).not.toHaveProperty("tools");
      expect(params).not.toHaveProperty("tool_choice");
      expect(params.output_config.format.type).toBe("json_schema");
      const system = typeof params.system === "string" ? params.system : params.system[0].text;
      expect(system).toContain("Your whole reply is one JSON record in the required format");
    }
  });

  it("close every object and stay inside the output format's complexity limits", async () => {
    for (const { output_config } of await unforcedRequests()) {
      const schema = output_config.format.schema;
      walk(schema, (node) => {
        const type = node.type;
        if (type === "object" || (Array.isArray(type) && type.includes("object"))) {
          expect(node.additionalProperties).toBe(false);
        }
      });
      const { optional, unions } = complexity(schema);
      expect(optional).toBeLessThanOrEqual(24);
      expect(unions).toBeLessThanOrEqual(16);
    }
  });
});

describe("reading the answer", () => {
  const message = (content: unknown[], stop_reason = "end_turn") => ({ content, stop_reason, usage }) as never;

  it("takes a forced model's tool input", () => {
    expect(readAnswer(message([{ type: "tool_use", id: "t", name: "n", input: { a: 1 } }], "tool_use"), "x")).toEqual({ a: 1 });
  });

  it("parses an unforced model's JSON text, past any thinking block", () => {
    const content = [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: '{"a":1}' }];
    expect(readAnswer(message(content), "x")).toEqual({ a: 1 });
  });

  it("says so when there is no answer, or the answer was cut off mid-record", () => {
    expect(() => readAnswer(message([]), "findings")).toThrow(/did not return findings/);
    expect(() => readAnswer(message([{ type: "text", text: '{"a":' }], "max_tokens"), "findings")).toThrow(
      /isn't valid JSON. stop_reason=max_tokens/
    );
    expect(() => readAnswer(message([{ type: "text", text: "[]" }]), "findings")).toThrow(/isn't a JSON object/);
  });
});

describe("a refusal", () => {
  it("fails the review once, without a retry", async () => {
    create.mockResolvedValue(refusal);
    await expect(
      analyzeContract({ document: { kind: "text", text: "C" }, standards: STANDARDS_LIBRARY, standardsVersion: STANDARDS_LIBRARY_VERSION, model: NEW })
    ).rejects.toBeInstanceOf(RefusalError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails an email draft once, without a retry", async () => {
    create.mockResolvedValue(refusal);
    await expect(generatePropertyEmail({ items: [], propertyLabel: "P", model: NEW })).rejects.toThrow(/declined to draft this email/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
