#!/usr/bin/env node
import { main } from "../src/main.js";

main(process.argv).catch((error) => {
  const message = error?.stack ?? error?.message ?? String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
