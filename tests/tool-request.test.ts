import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzeContract,
  closedSchema,
  extractContractTerms,
  forcesTool,
  generateClientEmail,
  generatePropertyEmail,
  RefusalError,
  toolRequest,
} from "@/lib/anthropic";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "@/lib/standards/v1";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";

/**
 * How each model is asked for its answer.
 *
 * Sonnet 5 and older are forced to the tool. Sonnet 5.5 rejects a forced
 * tool_choice, so it gets "auto" and a strict tool. Strict schemas must close
 * every object and stay inside the API's complexity limits, or every call 400s.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const toolResponse = (input: unknown) => ({
  content: [{ type: "tool_use", id: "toolu_test", name: "tool", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 0, output_tokens: 0 },
});

const refusal = { content: [], stop_reason: "refusal", usage: { input_tokens: 0, output_tokens: 0 } };

const NEW = "claude-sonnet-5-5";

beforeEach(() => {
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});

/** The tool each app call sends to Sonnet 5.5. */
async function strictTools() {
  create.mockResolvedValue(toolResponse({ clause_review: [], findings: [], subject: "s", body: "b", terms: [] }));
  await analyzeContract({ document: { kind: "text", text: "C" }, standards: STANDARDS_LIBRARY, standardsVersion: STANDARDS_LIBRARY_VERSION, model: NEW });
  await generateClientEmail({ findings: [], associateName: "A", contractLabel: "L", model: NEW });
  await generatePropertyEmail({ items: [], propertyLabel: "P", model: NEW });
  await extractContractTerms({ document: { kind: "text", text: "C" }, catalog: HOTEL_TERM_CATALOG, model: NEW });
  return create.mock.calls.map((c) => c[0]);
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
  it("forces the tool only for models that accept it", () => {
    expect(forcesTool("claude-sonnet-5")).toBe(true);
    expect(forcesTool("claude-haiku-4-5")).toBe(true);
    expect(forcesTool(NEW)).toBe(false);
    expect(forcesTool("claude-some-future-model")).toBe(false);
  });

  it("leaves a forced model's tool untouched", () => {
    const tool = { name: "t", input_schema: { type: "object" as const, properties: {} } };
    expect(toolRequest("claude-sonnet-5", tool)).toEqual({ tools: [tool], tool_choice: { type: "tool", name: "t" } });
  });

  it("closes every object, including nullable ones, and leaves enums and required lists alone", () => {
    const closed = closedSchema({
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
});

describe("Sonnet 5.5 requests", () => {
  it("send one strict tool with tool_choice auto, and tell the model to call it", async () => {
    for (const params of await strictTools()) {
      expect(params.tool_choice).toEqual({ type: "auto" });
      expect(params.tools).toHaveLength(1);
      expect(params.tools[0].strict).toBe(true);
      const system = typeof params.system === "string" ? params.system : params.system[0].text;
      expect(system).toContain(`calling the ${params.tools[0].name} tool exactly once`);
    }
  });

  it("close every object and stay inside the strict complexity limits", async () => {
    for (const { tools } of await strictTools()) {
      walk(tools[0].input_schema, (node) => {
        const type = node.type;
        if (type === "object" || (Array.isArray(type) && type.includes("object"))) {
          expect(node.additionalProperties).toBe(false);
        }
      });
      const { optional, unions } = complexity(tools[0].input_schema);
      expect(optional).toBeLessThanOrEqual(24);
      expect(unions).toBeLessThanOrEqual(16);
    }
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
