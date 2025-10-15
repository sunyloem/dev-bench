import fs from "fs/promises";
import path from "path";
import process from "process";
import readline from "readline";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Command } from "commander";

class MCPServerError extends Error {
  constructor(message) {
    super(message);
    this.name = "MCPServerError";
  }
}

class GeminiClient {
  constructor(modelName, apiKey, debugLog) {
    if (!apiKey) {
      throw new MCPServerError(
        "GOOGLE_API_KEY is not set. Export your Gemini API key before launching the server.",
      );
    }
    this.debugLog = debugLog;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: modelName });
      this.debugLog(`Initialized Gemini client with model "${modelName}"`);
    } catch (error) {
      throw new MCPServerError(`Failed to create Gemini client: ${error.message}`);
    }
  }

  async generate({ prompt, systemPrompt, temperature, topP }) {
    if (!prompt || typeof prompt !== "string") {
      throw new MCPServerError("'prompt' must be a non-empty string.");
    }

    const contents = [];
    if (systemPrompt) {
      contents.push({
        role: "system",
        parts: [{ text: systemPrompt }],
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: prompt }],
    });

    const generationConfig = {};
    if (typeof temperature === "number") {
      generationConfig.temperature = temperature;
    }
    if (typeof topP === "number") {
      generationConfig.topP = topP;
    }

    try {
      const result = await this.model.generateContent({
        contents,
        generationConfig: Object.keys(generationConfig).length ? generationConfig : undefined,
      });
      const text = result?.response?.text();
      if (!text) {
        throw new MCPServerError("Gemini response did not contain text output.");
      }
      return text;
    } catch (error) {
      throw new MCPServerError(`Gemini call failed: ${error.message}`);
    }
  }
}

class LocalMCPServer {
  constructor({ root, modelName, debug }) {
    this.root = path.resolve(root);
    this.debug = Boolean(debug);

    const log = (message) => {
      if (this.debug) {
        process.stderr.write(`[assets-creator] ${message}\n`);
      }
    };
    this.debugLog = log;

    log(`Using root: ${this.root}`);

    let geminiClient = null;
    try {
      geminiClient = new GeminiClient(
        modelName,
        process.env.GOOGLE_API_KEY ?? "",
        log,
      );
    } catch (error) {
      log(error.message);
    }
    this.gemini = geminiClient;

    this.tools = new Map([
      [
        "read_file",
        {
          name: "read_file",
          description: "Read a UTF-8 encoded text file relative to the server root.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path relative to the configured root.",
              },
            },
            required: ["path"],
            additionalProperties: false,
          },
          handler: this.handleReadFile.bind(this),
        },
      ],
      [
        "write_file",
        {
          name: "write_file",
          description: "Write UTF-8 encoded content to a file relative to the server root.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path relative to the configured root.",
              },
              content: {
                type: "string",
                description: "Content that will replace the file.",
              },
              create_parents: {
                type: "boolean",
                description: "Create parent directories when missing.",
              },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
          handler: this.handleWriteFile.bind(this),
        },
      ],
      [
        "list_dir",
        {
          name: "list_dir",
          description: "List files at a path relative to the server root.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Directory path relative to the root. Defaults to '.'.",
              },
            },
            required: [],
            additionalProperties: false,
          },
          handler: this.handleListDir.bind(this),
        },
      ],
      [
        "call_gemini",
        {
          name: "call_gemini",
          description: "Send a prompt to the Gemini Nano Banana model to create game assets.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "User prompt sent to Gemini.",
              },
              system_prompt: {
                type: "string",
                description: "Optional system prompt to guide Gemini.",
              },
              temperature: {
                type: "number",
                description: "Sampling temperature (0.0-1.0).",
              },
              top_p: {
                type: "number",
                description: "Top-p nucleus sampling threshold.",
              },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
          handler: this.handleCallGemini.bind(this),
        },
      ],
    ]);
  }

  async run() {
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.sendError(null, { code: -32700, message: "Invalid JSON received." });
        continue;
      }

      if (typeof message !== "object" || message === null) {
        this.debugLog(`Ignoring non-object message: ${line}`);
        continue;
      }

      if ("method" in message) {
        const { method, params = {}, id } = message;
        if (id !== undefined) {
          const response = await this.handleRequest(id, method, params);
          if (response) this.send(response);
        } else {
          await this.handleNotification(method, params);
        }
      } else {
        this.debugLog(`Ignoring unknown message: ${line}`);
      }
    }
  }

  async handleRequest(id, method, params) {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-01-01",
            capabilities: {
              tools: true,
            },
            serverInfo: {
              name: "assets-creator",
              version: "0.1.0",
            },
          },
        };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: Array.from(this.tools.values()).map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
            nextCursor: null,
          },
        };
      case "tools/call": {
        const { name, arguments: args = {} } = params ?? {};
        if (!this.tools.has(name)) {
          return this.jsonrpcError(id, -32601, `Unknown tool '${name}'.`);
        }
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          return this.jsonrpcError(id, -32602, "arguments must be an object.");
        }
        const tool = this.tools.get(name);
        try {
          const toolResult = await tool.handler(args);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: toolResult?.text ?? "",
                },
              ],
              isError: Boolean(toolResult?.isError),
            },
          };
        } catch (error) {
          const message = error instanceof MCPServerError ? error.message : `Tool failed: ${error.message}`;
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: message }],
              isError: true,
            },
          };
        }
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: "pong" };
      case "shutdown":
        return { jsonrpc: "2.0", id, result: null };
      default:
        return this.jsonrpcError(id, -32601, `Unsupported method '${method}'.`);
    }
  }

  async handleNotification(method, params) {
    switch (method) {
      case "initialized":
        this.debugLog("Client initialized.");
        break;
      case "exit":
        process.exit(0);
        break;
      default:
        this.debugLog(`Unhandled notification '${method}' (${JSON.stringify(params)})`);
    }
  }

  async handleReadFile(args) {
    const { path: userPath } = args;
    if (typeof userPath !== "string") {
      throw new MCPServerError("'path' must be a string.");
    }
    const resolved = this.resolvePath(userPath);
    try {
      const data = await fs.readFile(resolved, { encoding: "utf-8" });
      return { text: data };
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new MCPServerError(`File not found: ${userPath}`);
      }
      if (error.code === "EISDIR") {
        throw new MCPServerError(`Path is a directory: ${userPath}`);
      }
      throw new MCPServerError(`Failed to read file ${userPath}: ${error.message}`);
    }
  }

  async handleWriteFile(args) {
    const { path: userPath, content, create_parents: createParents = false } = args;
    if (typeof userPath !== "string") {
      throw new MCPServerError("'path' must be a string.");
    }
    if (typeof content !== "string") {
      throw new MCPServerError("'content' must be a string.");
    }
    if (typeof createParents !== "boolean") {
      throw new MCPServerError("'create_parents' must be a boolean.");
    }

    const resolved = this.resolvePath(userPath);
    if (createParents) {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
    }

    try {
      await fs.writeFile(resolved, content, { encoding: "utf-8" });
      return { text: `Wrote ${path.relative(this.root, resolved)}` };
    } catch (error) {
      if (error.code === "EISDIR") {
        throw new MCPServerError(`Cannot write to directory path: ${userPath}`);
      }
      throw new MCPServerError(`Failed to write file ${userPath}: ${error.message}`);
    }
  }

  async handleListDir(args) {
    const userPath = args?.path ?? ".";
    if (typeof userPath !== "string") {
      throw new MCPServerError("'path' must be a string.");
    }
    const resolved = this.resolvePath(userPath);
    let entries;
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new MCPServerError(`Directory not found: ${userPath}`);
      }
      throw new MCPServerError(`Failed to list directory ${userPath}: ${error.message}`);
    }
    const names = entries
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((a, b) => a.localeCompare(b));
    return { text: names.join("\n") || "(empty)" };
  }

  async handleCallGemini(args) {
    if (!this.gemini) {
      throw new MCPServerError(
        "Gemini client is not configured. Ensure @google/generative-ai is installed and GOOGLE_API_KEY is exported.",
      );
    }

    const { prompt, system_prompt: systemPrompt, temperature, top_p: topP } = args;
    if (typeof prompt !== "string") {
      throw new MCPServerError("'prompt' must be a string.");
    }
    if (systemPrompt !== undefined && typeof systemPrompt !== "string") {
      throw new MCPServerError("'system_prompt' must be a string when provided.");
    }
    if (temperature !== undefined && typeof temperature !== "number") {
      throw new MCPServerError("'temperature' must be numeric when provided.");
    }
    if (topP !== undefined && typeof topP !== "number") {
      throw new MCPServerError("'top_p' must be numeric when provided.");
    }

    const text = await this.gemini.generate({
      prompt,
      systemPrompt,
      temperature,
      topP,
    });
    return { text };
  }

  resolvePath(userPath) {
    const resolved = path.resolve(this.root, userPath);
    if (resolved === this.root) {
      return resolved;
    }
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new MCPServerError(`Path '${userPath}' is outside of the server root.`);
    }
    return resolved;
  }

  send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  sendError(id, { code, message, data }) {
    this.send({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        ...(data ? { data } : {}),
      },
    });
  }

  jsonrpcError(id, code, message) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    };
  }
}

export async function main(argv = process.argv) {
  const program = new Command();
  program
    .name("mcp-assets-creator")
    .description("Local MCP server for creating game assets with Gemini Nano Banana.")
    .option(
      "--root <path>",
      "Directory the server is allowed to access (default: current directory).",
      process.cwd(),
    )
    .option(
      "--model <name>",
      "Gemini model name.",
      process.env.GEMINI_MODEL ?? "gemini-nano-banana",
    )
    .option("--debug", "Log debug information to stderr.", false);

  program.parse(argv);
  const options = program.opts();

  const server = new LocalMCPServer({
    root: options.root,
    modelName: options.model,
    debug: options.debug,
  });

  await server.run();
}

export { LocalMCPServer, GeminiClient, MCPServerError };
