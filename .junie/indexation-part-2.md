# Genia Indexation Reliability Improvement Plan

## Overview

This document outlines a comprehensive plan to improve the reliability of the indexation process in Genia. Based on a thorough analysis of the codebase, we've identified several issues that affect the reliability of the indexation process, particularly for small folders, and inconsistencies in database management when folders are deleted.

## Current Issues

1. **Small Folder Handling**: 
   - Small folders (< 100 files) use a smaller batch size (20 files) in the `IndexDatabaseService`, but the main process still uses a fixed batch size of 250 files for all folders.
   - This mismatch leads to inconsistent behavior and potentially slower indexing for small folders.

2. **ID Generation**:
   - Both folder IDs and file IDs are generated using `Date.now().toString()`, which could lead to duplicate IDs if multiple folders or files are indexed at the same time.
   - Duplicate IDs can cause database conflicts and data loss.

3. **Error Handling**:
   - There's error handling at multiple levels, but failed batches are not retried in the main process.
   - Errors in the database operations are not always properly propagated to the UI.

4. **Folder Deletion**:
   - When a folder is deleted, the `IndexingService` calls `removeFolderFromIndex` to remove all files for the folder from the database.
   - If this operation fails, the folder is still deleted from localStorage, leading to inconsistencies between the UI and the database.

5. **Race Conditions**:
   - The `fileSaveQueue` is processed asynchronously, which could lead to race conditions if a folder is deleted while its files are still being saved.
   - There's no proper synchronization between folder operations and file indexing operations.

6. **Cancellation**:
   - The indexing process can be cancelled, but there's no guarantee that all files in the `fileSaveQueue` will be properly filtered out if a folder is no longer being indexed.
   - This can lead to "ghost" files in the database that belong to folders that are no longer being tracked.

7. **Progress Tracking**:
   - Progress updates are throttled and only sent if significant progress has been made, which could lead to inconsistent progress reporting.
   - For small folders, progress updates might not be frequent enough to provide a good user experience.

8. **Memory Management**:
   - Very large files (> 10MB) are skipped to prevent memory issues, but there's no limit on the total memory usage of the `fileSaveQueue`.
   - This could lead to memory exhaustion if many large files are queued for indexing.

## Improvement Plan

### 1. Unified Batch Size Management

**Problem**: Inconsistent batch sizes between the main process and the database service.

**Solution**:
- Create a centralized configuration for batch sizes that is shared between the main process and the database service.
- Implement dynamic batch sizing in the main process based on folder size, similar to what's already done in the database service.

```javascript
// In main.js
const getBatchSizeForFolder = (fileCount) => {
  if (fileCount < 100) {
    return 20; // Small folder
  } else if (fileCount < 1000) {
    return 50; // Medium folder
  } else {
    return 250; // Large folder
  }
};

// Use this when processing the file save queue
const batchSize = getBatchSizeForFolder(totalFiles);
const batch = fileSaveQueue.splice(0, batchSize);
```

### 2. Robust ID Generation

**Problem**: Potential for duplicate IDs using `Date.now()`.

**Solution**:
- Replace `Date.now().toString()` with UUID generation for both folder and file IDs.
- Implement the `uuid` package which is already used in some parts of the codebase.

```javascript
// In main.js
const { v4: uuidv4 } = require('uuid');

// For folder IDs
const folderId = uuidv4();

// For file IDs
const fileId = uuidv4();
```

### 3. Enhanced Error Handling and Retry Logic

**Problem**: Insufficient retry logic for failed database operations.

**Solution**:
- Implement exponential backoff retry logic for database operations in the main process.
- Add more detailed error categorization to help diagnose issues.
- Ensure errors are properly propagated to the UI with actionable information.

```javascript
// In main.js
const saveWithRetry = async (batch, maxRetries = 3, initialDelay = 1000) => {
  let retries = 0;
  let delay = initialDelay;
  
  while (retries < maxRetries) {
    try {
      const result = await db.saveIndexedFilesBatch(batch);
      return result;
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        throw error;
      }
      
      console.log(`Retry ${retries}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
};
```

### 4. Atomic Folder Operations

**Problem**: Inconsistencies when folder deletion fails to remove indexed files.

**Solution**:
- Implement atomic operations for folder deletion that ensure both the folder and its indexed files are removed together.
- Use transactions where possible to ensure database consistency.
- Add a rollback mechanism for folder operations that fail.

```javascript
// In FoldersService
deleteFolder(id: string): Observable<boolean> {
  return this.indexingService.removeFolderFromIndex(id).pipe(
    switchMap(removed => {
      if (removed) {
        // Only delete from localStorage if database deletion succeeded
        return this.deleteFromLocalStorage(id);
      } else {
        return throwError('Failed to remove folder from index');
      }
    })
  );
}
```

### 5. Synchronization for Race Conditions

**Problem**: Race conditions between folder operations and file indexing.

**Solution**:
- Implement a locking mechanism for folder operations to prevent concurrent modifications.
- Add a synchronization layer that ensures file save operations are completed before folder operations.
- Use a queue system for folder operations that respects dependencies.

```javascript
// In main.js
const folderLocks = new Map();

const acquireFolderLock = async (folderPath) => {
  if (folderLocks.has(folderPath)) {
    await folderLocks.get(folderPath);
  }
  
  let releaseLock;
  const lockPromise = new Promise(resolve => {
    releaseLock = resolve;
  });
  
  folderLocks.set(folderPath, lockPromise);
  return releaseLock;
};

// Usage
const performFolderOperation = async (folderPath, operation) => {
  const releaseLock = await acquireFolderLock(folderPath);
  try {
    return await operation();
  } finally {
    releaseLock();
    folderLocks.delete(folderPath);
  }
};
```

### 6. Improved Cancellation Handling

**Problem**: Incomplete cancellation of queued file operations.

**Solution**:
- Enhance the cancellation token system to propagate to all async operations.
- Implement a more robust filtering mechanism for the file save queue.
- Add a cleanup process that runs after cancellation to ensure no orphaned files remain.

```javascript
// In main.js
const cancelIndexing = (folderPath) => {
  // Set indexing status to false
  folderIndexingStatus.set(folderPath, false);
  
  // Remove from folders being indexed
  foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);
  
  // Clear any queued files for this folder
  fileSaveQueue = fileSaveQueue.filter(file => file.folderPath !== folderPath);
  
  // Run cleanup to ensure no orphaned files
  cleanupOrphanedFiles(folderPath);
};
```

### 7. Enhanced Progress Tracking

**Problem**: Inconsistent progress reporting, especially for small folders.

**Solution**:
- Implement more frequent progress updates for small folders.
- Add a minimum update frequency regardless of progress percentage.
- Provide more detailed progress information including estimated time remaining.

```javascript
// In main.js
const updateProgress = (folderPath, indexedFiles, totalFiles) => {
  const progress = Math.round((indexedFiles / totalFiles) * 100);
  const isSmallFolder = totalFiles < 100;
  
  // For small folders, update more frequently
  const updateInterval = isSmallFolder ? 100 : 500; // ms
  
  // Use both time-based and progress-based throttling
  const now = Date.now();
  if (progress > lastProgressUpdate || now - lastProgressUpdateTime >= updateInterval) {
    lastProgressUpdate = progress;
    lastProgressUpdateTime = now;
    
    // Send update to renderer
    mainWindow.webContents.send('indexation-progress', {
      folderPath,
      indexedFiles,
      totalFiles,
      progress,
      estimatedTimeRemaining: calculateEstimatedTime(indexedFiles, totalFiles, startTime)
    });
  }
};
```

### 8. Memory Management Improvements

**Problem**: Potential memory exhaustion from unbounded queue growth.

**Solution**:
- Implement a memory budget for the file save queue.
- Add monitoring of memory usage during indexing.
- Implement adaptive throttling based on memory pressure.

```javascript
// In main.js
const MAX_QUEUE_SIZE_MB = 100; // 100MB max queue size
let currentQueueSizeBytes = 0;

const addToSaveQueue = (file) => {
  // Estimate file size in memory (content length + overhead)
  const estimatedSizeBytes = (file.content?.length || 0) + 1000;
  
  // Check if adding this file would exceed our memory budget
  if (currentQueueSizeBytes + estimatedSizeBytes > MAX_QUEUE_SIZE_MB * 1024 * 1024) {
    // Wait for queue to process before adding more
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (currentQueueSizeBytes + estimatedSizeBytes <= MAX_QUEUE_SIZE_MB * 1024 * 1024) {
          clearInterval(checkInterval);
          addFileToQueue(file, estimatedSizeBytes);
          resolve();
        }
      }, 100);
    });
  } else {
    // Add to queue immediately
    addFileToQueue(file, estimatedSizeBytes);
    return Promise.resolve();
  }
};

const addFileToQueue = (file, sizeBytes) => {
  fileSaveQueue.push(file);
  currentQueueSizeBytes += sizeBytes;
  
  // Start queue processing if not already running
  if (fileSaveTimer === null) {
    fileSaveTimer = setTimeout(processFileSaveQueue, FILE_SAVE_BATCH_DELAY);
  }
};
```

### 9. Database Integrity Checks

**Problem**: Potential database corruption or inconsistencies.

**Solution**:
- Implement periodic database integrity checks.
- Add a database repair mechanism for fixing inconsistencies.
- Implement a database vacuum operation to optimize performance.

```javascript
// In db.js
function checkDatabaseIntegrity() {
  return new Promise((resolve, reject) => {
    db.get("PRAGMA integrity_check", (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result.integrity_check === 'ok');
      }
    });
  });
}

function vacuumDatabase() {
  return new Promise((resolve, reject) => {
    db.run("VACUUM", (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}
```

### 10. Incremental Indexing Improvements

**Problem**: Full re-indexing is inefficient for small changes.

**Solution**:
- Enhance the incremental indexing system to better handle file changes.
- Implement a file change detection system based on checksums or modification times.
- Add support for partial content updates to avoid re-indexing entire files.

```javascript
// In IncrementalIndexingService
processFileChange(file, oldContent, newContent) {
  // If file is small, just replace the entire content
  if (file.size < 10000) {
    return this.updateFileContent(file.id, newContent);
  }
  
  // For larger files, calculate diff and update only changed portions
  const diff = this.calculateDiff(oldContent, newContent);
  return this.applyDiff(file.id, diff);
}
```

## Implementation Strategy

To implement these improvements effectively, we'll follow a phased approach:

### Phase 1: Critical Reliability Fixes (Weeks 1-2)
- Implement UUID generation for IDs
- Fix batch size inconsistencies
- Implement atomic folder operations
- Add basic retry logic for database operations

### Phase 2: Enhanced Error Handling and Synchronization (Weeks 3-4)
- Implement the locking mechanism for folder operations
- Enhance error handling with better categorization
- Improve cancellation handling
- Implement database integrity checks

### Phase 3: Performance and UX Improvements (Weeks 5-6)
- Enhance progress tracking
- Implement memory management improvements
- Optimize incremental indexing
- Add performance monitoring

### Phase 4: Testing and Refinement (Weeks 7-8)
- Comprehensive testing of all improvements
- Edge case handling
- Performance benchmarking
- Documentation updates

## Conclusion

By implementing these improvements, we expect to significantly enhance the reliability of the indexation process in Genia. The changes will address the current issues with small folder handling, ID generation, error handling, folder deletion, race conditions, cancellation, progress tracking, and memory management. This will result in a more robust and user-friendly indexing experience, particularly for edge cases like small folders and folder deletion scenarios.
