import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { LocalMCPServer } from "../src/main.js";

async function createServerRoot() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "assets-creator-"));
  return {
    root: tmpRoot,
    cleanup: () => fs.rm(tmpRoot, { recursive: true, force: true }),
  };
}

test("resolvePath prevents escaping the configured root", async (t) => {
  const { root, cleanup } = await createServerRoot();
  t.after(cleanup);

  const server = new LocalMCPServer({ root, modelName: "fake-model", debug: false });
  assert.throws(() => server.resolvePath("../etc/passwd"), /outside of the server root/);
});

test("handleReadFile returns file contents", async (t) => {
  const { root, cleanup } = await createServerRoot();
  t.after(cleanup);

  const server = new LocalMCPServer({ root, modelName: "fake-model", debug: false });
  const filePath = path.join(root, "example.txt");
  await fs.writeFile(filePath, "hello world", "utf-8");

  const result = await server.handleReadFile({ path: "example.txt" });
  assert.equal(result.text, "hello world");
});
