import {
  createJestGlobalSetup,
  DEFAULT_PARADEDB_VERSION,
} from "../../src/index.js";

export default createJestGlobalSetup({
  preset: "paradedb",
  version: DEFAULT_PARADEDB_VERSION,
});
