import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Observable, Subject, throwError, timer } from 'rxjs';
import { finalize, map, takeUntil, timeout } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import {
  IPCService,
  IPCRequest,
  IPCResponse,
  IPCEvent,
  IPCBatchRequest,
  IPCBatchResponse
} from './ipc-interfaces';

/**
 * Enhanced IPC Service
 *
 * This service implements the IPCService interface to provide enhanced IPC communication
 * between the Angular renderer process and the Electron main process.
 *
 * Features:
 * - Typed request/response pattern with correlation IDs
 * - Timeout handling for requests
 * - Batching of related operations to reduce IPC overhead
 * - Event handling with RxJS Observables
 */
@Injectable({
  providedIn: 'root'
})
export class EnhancedIPCService implements IPCService, OnDestroy {
  private isElectron: boolean;
  private pendingRequests = new Map<string, Subject<any>>();
  private eventSubjects = new Map<string, Subject<any>>();
  private destroy$ = new Subject<void>();

  // Default timeout for requests (30 seconds)
  private defaultTimeout = 30000;

  constructor(private ngZone: NgZone) {
    this.isElectron = !!(window && window.electronAPI);

    if (this.isElectron) {
      // Set up listener for responses
      window.electronAPI.on('ipc-response', (response: IPCResponse) => {
        this.handleResponse(response);
      });

      // Set up listener for batch responses
      window.electronAPI.on('ipc-batch-response', (response: IPCBatchResponse) => {
        this.handleBatchResponse(response);
      });

      // Set up listener for events
      window.electronAPI.on('ipc-event', (event: IPCEvent) => {
        this.handleEvent(event);
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    // Clean up any pending requests
    this.pendingRequests.forEach(subject => {
      subject.error(new Error('Service destroyed'));
      subject.complete();
    });
    this.pendingRequests.clear();

    // Clean up event subjects
    this.eventSubjects.forEach(subject => {
      subject.complete();
    });
    this.eventSubjects.clear();
  }

  /**
   * Send a request to the main process and get a response
   * @param channel The channel/method to invoke
   * @param payload The request payload
   * @param timeout Optional timeout in milliseconds
   * @returns Observable that emits the response
   */
  invoke<TRequest, TResponse>(
    channel: string,
    payload: TRequest,
    timeoutMs?: number
  ): Observable<TResponse> {
    if (!this.isElectron) {
      return throwError(() => new Error('Not running in Electron'));
    }

    const requestId = uuidv4();
    const request: IPCRequest = {
      id: requestId,
      timestamp: Date.now(),
      channel,
      payload,
      timeout: timeoutMs
    };

    const responseSubject = new Subject<TResponse>();
    this.pendingRequests.set(requestId, responseSubject);

    // Send the request to the main process
    window.electronAPI.sendRequest(request);

    // Return an observable that completes when the response is received
    // or errors out if the timeout is reached
    return responseSubject.pipe(
      timeout(timeoutMs || this.defaultTimeout),
      takeUntil(this.destroy$),
      finalize(() => {
        // Clean up the pending request when the observable completes or errors
        this.pendingRequests.delete(requestId);
      })
    );
  }

  /**
   * Send a one-way message to the main process (no response expected)
   * @param channel The channel/method to invoke
   * @param payload The message payload
   */
  send<T>(channel: string, payload: T): void {
    if (!this.isElectron) {
      console.error('Not running in Electron');
      return;
    }

    const request: IPCRequest = {
      id: uuidv4(),
      timestamp: Date.now(),
      channel,
      payload
    };

    window.electronAPI.sendOneWay(request);
  }

  /**
   * Listen for events from the main process
   * @param event The event name to listen for
   * @returns Observable that emits event data
   */
  on<T>(event: string): Observable<T> {
    if (!this.eventSubjects.has(event)) {
      this.eventSubjects.set(event, new Subject<T>());
    }

    return this.eventSubjects.get(event)!.asObservable().pipe(
      takeUntil(this.destroy$)
    );
  }

  /**
   * Send multiple requests as a batch to reduce IPC overhead
   * @param channel The channel/method to invoke
   * @param payloads Array of request payloads
   * @param timeout Optional timeout in milliseconds
   * @returns Observable that emits the batch response
   */
  batchInvoke<TRequest, TResponse>(
    channel: string,
    payloads: TRequest[],
    timeoutMs?: number
  ): Observable<TResponse[]> {
    if (!this.isElectron) {
      return throwError(() => new Error('Not running in Electron'));
    }

    if (!payloads.length) {
      return new Observable(subscriber => {
        subscriber.next([]);
        subscriber.complete();
      });
    }

    const batchId = uuidv4();
    const batchRequest: IPCBatchRequest = {
      id: batchId,
      timestamp: Date.now(),
      channel,
      payloads,
      timeout: timeoutMs
    };

    const responseSubject = new Subject<TResponse[]>();
    this.pendingRequests.set(batchId, responseSubject);

    // Send the batch request to the main process
    window.electronAPI.sendBatchRequest(batchRequest);

    // Return an observable that completes when the response is received
    // or errors out if the timeout is reached
    return responseSubject.pipe(
      timeout(timeoutMs || this.defaultTimeout),
      takeUntil(this.destroy$),
      finalize(() => {
        // Clean up the pending request when the observable completes or errors
        this.pendingRequests.delete(batchId);
      })
    );
  }

  /**
   * Handle a response from the main process
   * @param response The response object
   */
  private handleResponse(response: IPCResponse): void {
    const subject = this.pendingRequests.get(response.requestId);
    if (subject) {
      this.ngZone.run(() => {
        if (response.success) {
          subject.next(response.payload);
          subject.complete();
        } else {
          subject.error(new Error(response.error || 'Unknown error'));
        }
      });
    }
  }

  /**
   * Handle a batch response from the main process
   * @param response The batch response object
   */
  private handleBatchResponse(response: IPCBatchResponse): void {
    const subject = this.pendingRequests.get(response.requestId);
    if (subject) {
      this.ngZone.run(() => {
        if (response.success) {
          subject.next(response.payloads);
          subject.complete();
        } else {
          subject.error(new Error(response.errors?.join(', ') || 'Unknown batch error'));
        }
      });
    }
  }

  /**
   * Handle an event from the main process
   * @param event The event object
   */
  private handleEvent(event: IPCEvent): void {
    const subject = this.eventSubjects.get(event.event);
    if (subject) {
      this.ngZone.run(() => {
        subject.next(event.data);
      });
    }
  }
}

/**
 * Update Window interface to include the new electronAPI methods
 */
declare global {
  interface Window {
    electronAPI: {
      // Existing methods
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      isWindowMaximized: () => Promise<boolean>;
      showOpenDialog: (options: any) => Promise<any>;
      indexFolder: (folderPath: string, options?: any) => Promise<any>;
      cancelFolderIndexation: (folderPath: string) => Promise<any>;
      indexAllFolders: (folderPaths: string[], options?: any) => Promise<any>;
      startWatchingFolders: (folderPaths: string[]) => Promise<any>;
      stopWatchingFolders: () => Promise<any>;
      stopFolderIndexation: (folderPath: string) => Promise<any>;
      checkFolderIndexable: (folderPath: string) => Promise<any>;
      removeFileFromIndex: (filePath: string, folderId: string) => Promise<any>;
      removeFolderFromIndex: (folderPath: string) => Promise<any>;
      getIndexationErrorLog: (folderPath?: string) => Promise<any>;
      clearIndexationErrorLog: (folderPath?: string) => Promise<any>;
      getIndexedFilesForFolder: (folderPath: string) => Promise<any>;
      sendIndexedFilesResponse: (response: any) => Promise<any>;
      sendFolderIdResponse: (response: any) => Promise<any>;
      openDirectory: (directoryPath: string) => Promise<any>;
      getDatabasePath: () => Promise<any>;
      clearAllIndexedFiles: () => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      onIndexationProgress: (callback: (update: any) => void) => () => void;
      onSaveIndexedFilesBatch: (callback: (data: any) => void) => () => void;

      // New methods for enhanced IPC
      sendRequest: (request: IPCRequest) => void;
      sendOneWay: (request: IPCRequest) => void;
      sendBatchRequest: (request: IPCBatchRequest) => void;
    }
  }
}
