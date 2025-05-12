# Enhanced IPC Communication System

This document provides an overview of the enhanced IPC (Inter-Process Communication) system implemented in the Genia application. The enhancements include a middleware system, compression for large payloads, security features, and a service registry for dynamic service discovery.

## Middleware System

The middleware system allows for processing messages through a chain of middleware functions. This makes it easier to add features like validation, logging, compression, and security checks.

### Registering Middleware

```javascript
registerMiddleware({
  name: 'myMiddleware',
  priority: 50, // Lower numbers run first
  
  // Process individual requests
  processRequest: async (request, next) => {
    // Modify the request if needed
    request.modified = true;
    
    // Process the request through the rest of the middleware chain
    const processedRequest = await next(request);
    
    // Modify the response if needed
    processedRequest.responseModified = true;
    
    return processedRequest;
  },
  
  // Process batch requests
  processBatch: async (batchRequest, next) => {
    // Similar to processRequest but for batch requests
    return await next(batchRequest);
  }
});
```

## Compression

The compression middleware automatically compresses large payloads to improve performance. It only compresses payloads larger than a threshold (default: 10KB) to avoid overhead for small messages.

### How It Works

1. The middleware checks if the payload size exceeds the threshold
2. If it does, the payload is compressed using zlib
3. The compressed payload is encoded as base64 and sent
4. The receiving end decompresses the payload before processing

## Security

The security middleware adds message integrity verification using HMAC to protect against tampering. It also adds timestamps for replay protection.

### How It Works

1. The middleware adds a timestamp to each request
2. It generates an HMAC for the request using a secret key
3. The HMAC is verified on the receiving end to ensure the message hasn't been tampered with

## Service Registry

The service registry allows for dynamic registration and discovery of services. Services are registered in the main process and can be accessed from the renderer process.

### Registering a Service

```javascript
registerService('myService', {
  myMethod: async (arg1, arg2) => {
    // Implementation
    return result;
  },
  
  anotherMethod: () => {
    // Implementation
    return anotherResult;
  }
});
```

### Using a Service from Angular

```typescript
// List all available services
const services = await electronService.listServices();

// Get information about a specific service
const serviceInfo = await electronService.getService('myService');

// Invoke a method on a service
const result = await electronService.invokeServiceMethod(
  'myService',
  'myMethod',
  ['arg1', 'arg2']
);
```

## Example Component

An example component is provided in `src/components/example/ipc-example.component.ts` that demonstrates how to use the enhanced IPC system. It includes examples of:

1. Using the service registry
2. Sending large payloads that trigger compression
3. Sending batch requests

## Built-in Services

The following services are registered by default:

### systemInfo

Provides information about the system:

- `getAppVersion()`: Returns the application version
- `getPlatform()`: Returns the platform (win32, darwin, linux)
- `getArch()`: Returns the architecture (x64, ia32, arm64)
- `getNodeVersion()`: Returns the Node.js version
- `getElectronVersion()`: Returns the Electron version
- `getChromeVersion()`: Returns the Chrome version
- `getMemoryUsage()`: Returns memory usage information
- `getCPUUsage()`: Returns CPU usage information

### fileSystem

Provides file system operations:

- `readFile(filePath)`: Reads a file and returns its content
- `writeFile(filePath, content)`: Writes content to a file
- `listDirectory(directoryPath)`: Lists the contents of a directory

### database

Provides database operations:

- `getStats()`: Returns database statistics
- `runQuery(query, params)`: Runs a database query

## Implementation Details

The enhanced IPC system is implemented in the following files:

- `main.js`: Contains the middleware system, service registry, and IPC handlers
- `preload.js`: Exposes the IPC methods to the renderer process
- `src/providers/electron-window.service.ts`: Provides Angular services for interacting with the IPC system

## Best Practices

1. **Use the service registry** for organizing related functionality
2. **Batch related operations** to reduce IPC overhead
3. **Be mindful of payload size** - compression helps but it's still better to keep payloads small when possible
4. **Handle errors properly** - all IPC operations can fail and should have appropriate error handling
5. **Use typed interfaces** for IPC messages to ensure type safety
