import { afterEach, describe, expect, it, vi } from "vitest";
import { readOriginalDocx } from "@/lib/read-original";

/** Storage that answers each download from a list, in order. */
function storageAnswering(answers: ({ bytes: number[] } | { error: string } | { throws: string })[]) {
  const asked: string[] = [];
  const admin = {
    storage: {
      from: () => ({
        download: async (path: string) => {
          asked.push(path);
          const answer = answers[asked.length - 1];
          if ("throws" in answer) throw new Error(answer.throws);
          return "bytes" in answer ? { data: new Blob([new Uint8Array(answer.bytes)]), error: null } : { data: null, error: { message: answer.error } };
        },
      }),
    },
  };
  return { admin: admin as never, asked };
}

afterEach(() => vi.restoreAllMocks());

describe("reading the Word file for a review", () => {
  it("returns the file on the first read", async () => {
    const { admin, asked } = storageAnswering([{ bytes: [1, 2, 3] }]);
    expect([...(await readOriginalDocx(admin, "a/original.docx", 0))]).toEqual([1, 2, 3]);
    expect(asked).toEqual(["a/original.docx"]);
  });

  it("tries again after a failed read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, asked } = storageAnswering([{ error: "gateway timeout" }, { throws: "socket hang up" }, { bytes: [7] }]);
    expect([...(await readOriginalDocx(admin, "a/original.docx", 0))]).toEqual([7]);
    expect(asked).toHaveLength(3);
  });

  it("gives up after three reads, and says so plainly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, asked } = storageAnswering([{ error: "gateway timeout" }, { error: "gateway timeout" }, { error: "object not found" }]);
    await expect(readOriginalDocx(admin, "a/original.docx", 0)).rejects.toThrow(
      "The Word file couldn't be read, so nothing was reviewed (object not found). Use Retry to run it again."
    );
    expect(asked).toHaveLength(3);
  });
});
