import { z } from "zod";
import { randomUUID } from "node:crypto";

import { APP_NAME, APP_VERSION } from "./types";

export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_ADDRESS"
  | "LIVE_DATA_UNAVAILABLE"
  | "OKX_API_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "PAYMENT_NOT_CONFIGURED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor() {
    super("UPSTREAM_TIMEOUT", "The OKX transaction-history request timed out.", 504, true);
    this.name = "UpstreamTimeoutError";
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

function getResponseDataSource(response: Response): Promise<string | null> {
  return response
    .clone()
    .json()
    .then((body: unknown) => {
      if (body && typeof body === "object" && "dataSource" in body && typeof body.dataSource === "string") {
        return body.dataSource;
      }

      return null;
    })
    .catch(() => null);
}

export async function handleApiRequest(
  request: Request,
  endpoint: string,
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let response: Response;
  let errorCode: ErrorCode | null = null;

  try {
    response = await handler();
  } catch (error) {
    errorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
    response = errorResponse(error);
  }

  response = withRequestId(response, requestId);
  const dataSource = await getResponseDataSource(response);
  const paymentRequired = response.headers.has("PAYMENT-REQUIRED");
  const paymentReceipt = response.headers.has("PAYMENT-RESPONSE");
  console.log(JSON.stringify({
    requestId,
    service: APP_NAME,
    version: APP_VERSION,
    endpoint,
    method: request.method,
    status: response.status,
    durationMs: Date.now() - startedAt,
    dataSource,
    errorCode,
    paymentRequired,
    paymentVerified: paymentReceipt && response.status < 400,
    settlementSucceeded: paymentReceipt && response.status < 400,
  }));
  return response;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_REQUEST", "Request body must be valid JSON.", 400);
  }
}

export function validationError(result: z.SafeParseError<unknown>): AppError {
  const issue = result.error.issues[0];
  const code: ErrorCode = issue?.path[0] === "address" ? "INVALID_ADDRESS" : "INVALID_REQUEST";
  return new AppError(code, issue?.message ?? "Invalid request.", 400);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof SyntaxError) {
    return Response.json(
      { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } },
    { status: 500 },
  );
}
