/**
 * IPC Interfaces
 *
 * This file defines TypeScript interfaces for IPC (Inter-Process Communication) messages
 * between the Angular renderer process and the Electron main process.
 *
 * It implements the medium-term improvements from the planning document:
 * - Create typed IPC interfaces
 * - Implement request/response pattern with correlation IDs
 * - Add timeout handling
 * - Reduce IPC traffic by batching related operations
 */

import { Observable } from 'rxjs';

/**
 * Base interface for all IPC messages
 */
export interface IPCMessage {
  /** Unique identifier for the message */
  id: string;
  /** Timestamp when the message was created */
  timestamp: number;
}

/**
 * Interface for IPC request messages
 */
export interface IPCRequest<T = any> extends IPCMessage {
  /** Channel/method to invoke */
  channel: string;
  /** Request payload */
  payload: T;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Interface for IPC response messages
 */
export interface IPCResponse<T = any> extends IPCMessage {
  /** ID of the request this response is for */
  requestId: string;
  /** Response payload */
  payload: T;
  /** Whether the request was successful */
  success: boolean;
  /** Error message if the request failed */
  error?: string;
}

/**
 * Interface for IPC event messages (main -> renderer)
 */
export interface IPCEvent<T = any> extends IPCMessage {
  /** Event name */
  event: string;
  /** Event data */
  data: T;
}

/**
 * Interface for batch operations
 */
export interface IPCBatchRequest extends IPCMessage {
  /** Channel/method to invoke */
  channel: string;
  /** Array of request payloads */
  payloads: any[];
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Interface for batch operation responses
 */
export interface IPCBatchResponse extends IPCMessage {
  /** ID of the batch request this response is for */
  requestId: string;
  /** Array of response payloads */
  payloads: any[];
  /** Whether all operations were successful */
  success: boolean;
  /** Array of errors for failed operations */
  errors?: string[];
}

/**
 * Interface for the IPC service
 */
export interface IPCService {
  /**
   * Send a request to the main process and get a response
   * @param channel The channel/method to invoke
   * @param payload The request payload
   * @param timeout Optional timeout in milliseconds
   * @returns Observable that emits the response
   */
  invoke<TRequest, TResponse>(channel: string, payload: TRequest, timeout?: number): Observable<TResponse>;

  /**
   * Send a one-way message to the main process (no response expected)
   * @param channel The channel/method to invoke
   * @param payload The message payload
   */
  send<T>(channel: string, payload: T): void;

  /**
   * Listen for events from the main process
   * @param event The event name to listen for
   * @returns Observable that emits event data
   */
  on<T>(event: string): Observable<T>;

  /**
   * Send multiple requests as a batch to reduce IPC overhead
   * @param channel The channel/method to invoke
   * @param payloads Array of request payloads
   * @param timeout Optional timeout in milliseconds
   * @returns Observable that emits the batch response
   */
  batchInvoke<TRequest, TResponse>(channel: string, payloads: TRequest[], timeout?: number): Observable<TResponse[]>;
}

/**
 * Window indexation progress update interface
 */
export interface IndexationProgressUpdate {
  folderId: string;
  folderPath: string;
  indexedFiles: number;
  totalFiles: number;
  progress: number;
  status?: 'indexing' | 'indexed' | 'stopped';
  errors?: number;
  currentFile?: string;
}

/**
 * Interface for folder count information in batch updates
 */
export interface FolderCountInfo {
  folderId: string;
  count: number;
}

/**
 * Interface for indexed files batch updates
 */
export interface IndexedFilesBatch {
  files?: any[];
  filesCount?: number;
  errorsCount?: number;
  folderCounts?: { [folderPath: string]: FolderCountInfo };
}

/**
 * Interface for file indexing options
 */
export interface IndexingOptions {
  canBeCancelled?: boolean;
  batchSize?: number;
  includeExtensions?: string[];
  excludeExtensions?: string[];
  maxFileSize?: number;
}

/**
 * Interface for open dialog options
 */
export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: { name: string; extensions: string[] }[];
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >;
  message?: string;
}

/**
 * Interface for open dialog results
 */
export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
  bookmarks?: string[];
}
