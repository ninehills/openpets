export type OpenPetsClientErrorCode =
  | "not-running"
  | "timeout"
  | "not-openpets"
  | "invalid-response"
  | "incompatible-protocol"
  | "rejected"
  | "network-error";

export class OpenPetsClientError extends Error {
  readonly code: OpenPetsClientErrorCode;
  readonly status: number | undefined;

  constructor(code: OpenPetsClientErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenPetsClientError";
    this.code = code;
    this.status = options.status;
  }
}
