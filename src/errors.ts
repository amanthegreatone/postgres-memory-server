export class PostgresMemoryServerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SnapshotUnsupportedError extends PostgresMemoryServerError {
  constructor(database: string) {
    super(
      `Snapshots are not supported when the database name is "${database}". ` +
        `Use a non-system database name such as "testdb" before calling snapshot() or restore().`,
    );
  }
}

export class ServerStoppedError extends PostgresMemoryServerError {
  constructor() {
    super("The PostgresMemoryServer has already been stopped.");
  }
}

export class ExtensionInstallError extends PostgresMemoryServerError {
  constructor(extensionName: string, cause?: Error) {
    super(
      `Failed to install the "${extensionName}" extension. ${cause?.message ?? ""}`.trim(),
      cause ? { cause } : undefined,
    );
  }
}
