// Loads the repo-root .env for standalone scripts (seed, smoke) run from apps/web.
// Import this module FIRST so DATABASE_URL is set before @darak/db instantiates the client.
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

loadEnvConfig(resolve(__dirname, "../../.."), true, { info: () => {}, error: console.error });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "file:./dev.db";
