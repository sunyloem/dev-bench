# Assets Creator MCP Server

This project contains a local [Model Context Protocol](https://github.com/modelcontextprotocol) (MCP) server built with Node.js that can edit files within a sandboxed directory and call the Gemini Nano Banana model through the official `@google/generative-ai` client. It is tailored for workflows that need to generate or refine game assets using Gemini while keeping local file editing in scope.

## Features

- JSON-RPC MCP server over stdio
- File tooling: `read_file`, `write_file`, and `list_dir`
- Gemini tooling: `call_gemini` for prompting the Gemini Nano Banana model
- Root directory sandbox so the server only touches files inside the configured root path

## Prerequisites

- Node.js 18+
- `GOOGLE_API_KEY` environment variable containing a valid Gemini key

## Installation

```bash
cd assets_creator
npm install
```

## Running the server

```bash
export GOOGLE_API_KEY="your_api_key"
npx mcp-assets-creator --root /path/to/game/project --model gemini-nano-banana --debug
```

The server communicates via stdio using JSON-RPC 2.0. Point your MCP-compatible client to the `mcp-assets-creator` executable, and it will expose the file and Gemini tools.

### Tools

| Tool          | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| `read_file`   | Reads a UTF-8 file relative to the configured root.                         |
| `write_file`  | Writes content to a file; can optionally create missing parent directories. |
| `list_dir`    | Lists entries in a directory relative to the root.                          |
| `call_gemini` | Calls Gemini Nano Banana with optional system prompt and sampling controls. |

## Development

- Run `node ./bin/mcp-assets-creator.js --debug` to execute without installing globally.
- The server logs debug output to stderr when `--debug` is supplied.
- Modify `src/main.js` to add new tools or adjust the Gemini integration as needed.
