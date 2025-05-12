# IPC Communication Enhancement

This document describes the enhancements made to the Inter-Process Communication (IPC) system in the Genia application, which facilitates communication between the Angular renderer process and the Electron main process.

## Overview of Changes

The following short-term improvements have been implemented:

1. **Standardized IPC Message Format**: Created a consistent format for all IPC messages
2. **Added Validation**: Implemented validation for all IPC message data
3. **Improved Error Handling**: Added comprehensive error handling for IPC communication
4. **Added Logging**: Implemented detailed logging for IPC operations

## Implementation Details

### 1. Standardized IPC Message Format

Two primary interfaces have been created to standardize IPC communication:

- `IPCMessage<T>`: A generic interface for messages sent from the renderer to the main process
- `IPCResponse<T>`: A generic interface for responses sent from the main process to the renderer

#### IPCMessage Interface

```typescript
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
```

#### IPCResponse Interface

```typescript
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
```

### 2. Validation

Validation functions ensure that messages and responses conform to the expected format:

- `validateIPCMessage(message: any): message is IPCMessage`
- `validateIPCResponse(response: any): response is IPCResponse`

These functions use TypeScript type guards to provide type safety.

### 3. Error Handling

The enhanced IPC system includes comprehensive error handling:

- Standardized error responses with error codes
- Detailed error messages
- RxJS error handling with the `catchError` operator
- Try/catch blocks around all IPC operations

### 4. Logging

Logging functions provide detailed information about IPC operations:

- `logIPCMessage(direction: 'send' | 'receive', message: IPCMessage)`
- `logIPCResponse(direction: 'send' | 'receive', response: IPCResponse)`

These functions log the direction, channel, message ID, correlation ID, timestamp, and data/error information.

## New Files

The following new files have been added to implement these enhancements:

1. `src/providers/ipc-message.ts`: Defines the standardized message format, validation functions, and logging functions
2. `src/providers/ipc.service.ts`: Provides an enhanced IPC service that wraps the ElectronWindowService
3. `src/components/ipc-example/ipc-example.component.ts`: Demonstrates how to use the enhanced IPC service

## How to Use the Enhanced IPC Service

### 1. Import the IPCService

```typescript
import { IPCService } from '../../providers/ipc.service';
```

### 2. Inject the Service

```typescript
constructor(private ipcService: IPCService) {}
```

### 3. Use the Service Methods

All methods return Observables, allowing for reactive programming patterns:

```typescript
this.ipcService.isMaximized()
  .pipe(takeUntil(this.destroy$))
  .subscribe({
    next: (maximized) => {
      this.isMaximized = maximized;
      console.log('Window is maximized:', maximized);
    },
    error: (error) => {
      this.errorMessage = `Error checking if window is maximized: ${error.message}`;
      console.error('Error checking if window is maximized:', error);
    }
  });
```

### 4. Subscribe to Events

The service provides Observables for events from the main process:

```typescript
this.ipcService.indexationProgress$
  .pipe(takeUntil(this.destroy$))
  .subscribe(progress => {
    this.indexationProgress = progress;
    console.log('Indexation progress update:', progress);
  });
```

### 5. Proper Error Handling

Always handle errors in the subscribe method:

```typescript
this.ipcService.someMethod()
  .pipe(takeUntil(this.destroy$))
  .subscribe({
    next: (result) => {
      // Handle success
    },
    error: (error) => {
      // Handle error
      console.error('Error:', error);
    }
  });
```

## Benefits

The enhanced IPC system provides several benefits:

1. **Improved Reliability**: Standardized message format and validation reduce the risk of errors
2. **Better Debugging**: Detailed logging makes it easier to diagnose issues
3. **Enhanced Error Handling**: Comprehensive error handling improves the user experience
4. **Type Safety**: TypeScript interfaces and type guards provide better type safety
5. **Reactive Programming**: Observable-based API integrates well with Angular's reactive programming model

## Future Improvements

The following medium-term improvements are planned:

1. **Create typed IPC interfaces**: Define TypeScript interfaces for all specific IPC messages
2. **Implement request/response pattern**: Use a consistent request/response pattern with correlation IDs
3. **Add timeout handling**: Implement timeouts for IPC operations
4. **Reduce IPC traffic**: Batch related operations to reduce IPC overhead

## Example Component

An example component has been created to demonstrate how to use the enhanced IPC service. See `src/components/ipc-example/ipc-example.component.ts` for a complete example.
