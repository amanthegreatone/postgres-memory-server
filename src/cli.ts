import process from "node:process";

import { PostgresMemoryServer } from "./PostgresMemoryServer.js";
import type {
  PostgresMemoryServerOptions,
  PostgresMemoryServerPreset,
} from "./types.js";

async function main(): Promise<void> {
  const { options, initFiles, json } = parseArgs(process.argv.slice(2));

  const server = await PostgresMemoryServer.create(options);

  try {
    for (const file of initFiles) {
      await server.runSqlFile(file);
    }

    const payload = {
      uri: server.getUri(),
      host: server.getHost(),
      port: server.getPort(),
      database: server.getDatabase(),
      username: server.getUsername(),
      password: server.getPassword(),
      image: server.getImage(),
    };

    if (json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(`POSTGRES_MEMORY_SERVER_URI=${payload.uri}\n`);
      process.stdout.write(`POSTGRES_MEMORY_SERVER_HOST=${payload.host}\n`);
      process.stdout.write(`POSTGRES_MEMORY_SERVER_PORT=${payload.port}\n`);
      process.stdout.write(
        `POSTGRES_MEMORY_SERVER_DATABASE=${payload.database}\n`,
      );
      process.stdout.write(
        `POSTGRES_MEMORY_SERVER_USERNAME=${payload.username}\n`,
      );
      process.stdout.write(
        `POSTGRES_MEMORY_SERVER_PASSWORD=${payload.password}\n`,
      );
      process.stdout.write(`POSTGRES_MEMORY_SERVER_IMAGE=${payload.image}\n`);
      process.stdout.write("\nPress Ctrl+C to stop the container.\n");
    }

    const stop = async () => {
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void stop();
    });
    process.on("SIGTERM", () => {
      void stop();
    });

    await new Promise<void>(() => {
      // Intentionally never resolve. Signals will stop the process.
    });
  } catch (error) {
    await server.stop();
    throw error;
  }
}

type ParsedArgs = {
  options: PostgresMemoryServerOptions;
  initFiles: string[];
  json: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const options: PostgresMemoryServerOptions = {};
  const initFiles: string[] = [];
  const extensions: string[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--preset": {
        const value = readValue(
          argv,
          ++index,
          arg,
        ) as PostgresMemoryServerPreset;
        options.preset = value;
        break;
      }
      case "--image": {
        options.image = readValue(argv, ++index, arg);
        break;
      }
      case "--version": {
        options.version = readValue(argv, ++index, arg);
        break;
      }
      case "--database": {
        options.database = readValue(argv, ++index, arg);
        break;
      }
      case "--username": {
        options.username = readValue(argv, ++index, arg);
        break;
      }
      case "--password": {
        options.password = readValue(argv, ++index, arg);
        break;
      }
      case "--extension": {
        extensions.push(readValue(argv, ++index, arg));
        break;
      }
      case "--init-file": {
        initFiles.push(readValue(argv, ++index, arg));
        break;
      }
      case "--json": {
        json = true;
        break;
      }
      case "--help": {
        printHelp();
        process.exit(0);
      }
      default: {
        throw new Error(`Unknown argument: ${arg}`);
      }
    }
  }

  if (extensions.length > 0) {
    options.extensions = extensions;
  }

  return { options, initFiles, json };
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp(): void {
  process.stdout.write(`postgres-memory-server\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --preset postgres|paradedb\n`);
  process.stdout.write(`  --version <tag>\n`);
  process.stdout.write(`  --image <image>\n`);
  process.stdout.write(`  --database <name>\n`);
  process.stdout.write(`  --username <name>\n`);
  process.stdout.write(`  --password <password>\n`);
  process.stdout.write(`  --extension <name>      repeatable\n`);
  process.stdout.write(`  --init-file <path>      repeatable\n`);
  process.stdout.write(`  --json\n`);
  process.stdout.write(`  --help\n`);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
