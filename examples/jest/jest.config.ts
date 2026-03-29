import type { Config } from "jest";

const config: Config = {
  globalSetup: "./globalSetup.ts",
  globalTeardown: "./globalTeardown.ts",
  testEnvironment: "node",
};

export default config;
