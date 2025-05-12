/**
 * IPC Message Format and Validation
 *
 * This file defines the standardized format for IPC messages between the renderer process (Angular)
 * and the main process (Electron), along with validation functions to ensure message integrity.
 */

/**
 * Standard IPC message format for all IPC communications
 */
export interface IPCMessage<T = any> {
  /** Unique identifier for the message */
  id: string;

  /** Channel/type of the message */
  channel: string;

  /** Timestamp when the message was created */
  timestamp: number;

  /** Payload data */
  data: T;

  /** Optional correlation ID for request/response pattern */
  correlationId?: string;
}

/**
 * Standard IPC response format
 */
export interface IPCResponse<T = any> {
  /** Whether the operation was successful */
  success: boolean;

  /** Response data (if success is true) */
  data?: T;

  /** Error message (if success is false) */
  error?: string;

  /** Error code (if success is false) */
  errorCode?: string;

  /** Correlation ID matching the request */
  correlationId?: string;

  /** Timestamp when the response was created */
  timestamp: number;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Create a standardized IPC message
 *
 * @param channel The channel/type of the message
 * @param data The payload data
 * @param correlationId Optional correlation ID for request/response pattern
 * @returns A standardized IPC message
 */
export function createIPCMessage<T = any>(channel: string, data: T, correlationId?: string): IPCMessage<T> {
  return {
    id: generateMessageId(),
    channel,
    timestamp: Date.now(),
    data,
    correlationId
  };
}

/**
 * Create a standardized IPC response
 *
 * @param success Whether the operation was successful
 * @param data The response data (if success is true)
 * @param error The error message (if success is false)
 * @param errorCode The error code (if success is false)
 * @param correlationId The correlation ID matching the request
 * @returns A standardized IPC response
 */
export function createIPCResponse<T = any>(
  success: boolean,
  data?: T,
  error?: string,
  errorCode?: string,
  correlationId?: string
): IPCResponse<T> {
  return {
    success,
    data,
    error,
    errorCode,
    correlationId,
    timestamp: Date.now()
  };
}

/**
 * Validate an IPC message
 *
 * @param message The message to validate
 * @returns Whether the message is valid
 */
export function validateIPCMessage(message: any): message is IPCMessage {
  return (
    message &&
    typeof message === 'object' &&
    typeof message.id === 'string' &&
    typeof message.channel === 'string' &&
    typeof message.timestamp === 'number' &&
    message.data !== undefined
  );
}

/**
 * Validate an IPC response
 *
 * @param response The response to validate
 * @returns Whether the response is valid
 */
export function validateIPCResponse(response: any): response is IPCResponse {
  return (
    response &&
    typeof response === 'object' &&
    typeof response.success === 'boolean' &&
    typeof response.timestamp === 'number' &&
    (response.success ? response.data !== undefined : typeof response.error === 'string')
  );
}

/**
 * Log an IPC message for debugging
 *
 * @param direction The direction of the message ('send' or 'receive')
 * @param message The message to log
 */
export function logIPCMessage(direction: 'send' | 'receive', message: IPCMessage): void {
  console.log(`[IPC ${direction.toUpperCase()}] ${message.channel}`, {
    id: message.id,
    correlationId: message.correlationId,
    timestamp: new Date(message.timestamp).toISOString(),
    data: message.data
  });
}

/**
 * Log an IPC response for debugging
 *
 * @param direction The direction of the response ('send' or 'receive')
 * @param response The response to log
 */
export function logIPCResponse(direction: 'send' | 'receive', response: IPCResponse): void {
  console.log(`[IPC ${direction.toUpperCase()} RESPONSE]`, {
    success: response.success,
    correlationId: response.correlationId,
    timestamp: new Date(response.timestamp).toISOString(),
    data: response.data,
    error: response.error,
    errorCode: response.errorCode
  });
}
