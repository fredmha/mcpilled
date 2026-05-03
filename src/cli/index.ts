#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { configPath, resetConfig } from "../config/store.js";

const program = new Command();

program.name("mcp-gateway").description("Local-first MCP Gateway").version("0.1.0");

program
  .command("start")
  .description("Start the web app and gateway")
  .action(async () => {
    await import("../server.js");
  });

program
  .command("reset")
  .description("Reset local gateway config")
  .action(async () => {
    const { apiKey } = await resetConfig();
    console.log("Reset complete.");
    console.log(`New API key: ${apiKey}`);
  });

program
  .command("export-config")
  .description("Print the local gateway config")
  .action(async () => {
    console.log(await readFile(configPath, "utf8"));
  });

program.parse();
