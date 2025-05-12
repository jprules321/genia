# Genia Indexing System Documentation

## Overview

The Genia Indexing System is responsible for indexing files in user-selected folders, storing their content in a SQLite database, and providing search functionality. The system has been refactored to improve performance, reliability, and maintainability.

## Architecture

The indexing system has been split into several specialized services to improve separation of concerns:

1. **IndexingService**: Coordinates the indexing process and manages the overall state.
2. **FileIndexingService**: Handles the actual indexing of files.
3. **IndexDatabaseService**: Manages database operations related to indexing.
4. **FileSystemService**: Handles file system operations.
5. **ContentTypeService**: Detects and manages content types for files.
6. **WorkerPoolService**: Manages a pool of workers for parallel processing.
7. **IncrementalIndexingService**: Handles incremental indexing of changed files.

## Key Features

### Error Handling and Reliability

- Comprehensive error handling throughout the indexing process
- Error categorization for better error reporting
- Retry logic for failed operations
- Transaction support for database operations

### Performance Optimization

- Chunked processing for large files
- Optimized database operations
- Worker pool for parallel processing
- Incremental indexing for changed files

### User Experience

- Improved progress tracking
- Cancellation support for long-running operations
- Better error messages

## Usage

### Basic Indexing

To index a folder:

```typescript
import { IndexingService } from '../providers/indexing.service';

constructor(private indexingService: IndexingService) {}

indexFolder(folder: Folder): void {
  this.indexingService.indexFolder(folder).subscribe(
    result => {
      console.log('Folder indexed successfully:', result);
    },
    error => {
      console.error('Error indexing folder:', error);
    }
  );
}
```

### Cancellable Indexing

To index a folder with cancellation support:

```typescript
import { IndexingService, CancellationToken } from '../providers/indexing.service';

constructor(private indexingService: IndexingService) {}

indexFolder(folder: Folder): void {
  const cancellationToken = new CancellationToken();
  
  this.indexingService.indexFolder(folder, cancellationToken).subscribe(
    result => {
      console.log('Folder indexed successfully:', result);
    },
    error => {
      console.error('Error indexing folder:', error);
    }
  );
  
  // To cancel the operation:
  // cancellationToken.cancel();
}
```

### Incremental Indexing

To process file changes incrementally:

```typescript
import { IncrementalIndexingService, FileChange } from '../providers/incremental-indexing.service';

constructor(private incrementalIndexingService: IncrementalIndexingService) {}

processFileChanges(folderId: string, folderPath: string, changes: FileChange[]): void {
  this.incrementalIndexingService.processFileChanges(folderId, folderPath, changes).subscribe(
    count => {
      console.log(`Processed ${count} file changes`);
    },
    error => {
      console.error('Error processing file changes:', error);
    }
  );
}
```

### Content Type Detection

To check if a file is indexable:

```typescript
import { ContentTypeService } from '../providers/content-type.service';

constructor(private contentTypeService: ContentTypeService) {}

checkFileIndexable(filePath: string, fileSize: number): void {
  this.contentTypeService.isFileIndexable(filePath, fileSize).subscribe(
    result => {
      if (result.indexable) {
        console.log(`File ${filePath} is indexable`);
      } else {
        console.log(`File ${filePath} is not indexable: ${result.reason}`);
      }
    },
    error => {
      console.error('Error checking if file is indexable:', error);
    }
  );
}
```

### Parallel Processing

To execute tasks in parallel:

```typescript
import { WorkerPoolService, WorkerTask } from '../providers/worker-pool.service';

constructor(private workerPoolService: WorkerPoolService) {}

processTasks(): void {
  const tasks: WorkerTask<string, string>[] = [
    {
      id: '1',
      data: 'Task 1',
      execute: async (data) => {
        // Do some work
        return `Processed ${data}`;
      }
    },
    {
      id: '2',
      data: 'Task 2',
      execute: async (data) => {
        // Do some work
        return `Processed ${data}`;
      }
    }
  ];
  
  this.workerPoolService.executeAll(tasks).subscribe(
    results => {
      console.log('All tasks completed:', results);
    },
    error => {
      console.error('Error executing tasks:', error);
    }
  );
}
```

## Implementation Details

### Database Schema

The indexing system uses a SQLite database with the following schema:

```sql
CREATE TABLE indexed_files (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT,
  last_indexed TEXT,
  last_modified TEXT
)
```

Indexes are created on `folder_id` and `path` for faster queries.

### File Processing Flow

1. User selects a folder to index
2. IndexingService coordinates the indexing process
3. FileSystemService gets all files in the folder
4. ContentTypeService checks if each file is indexable
5. FileIndexingService processes each file
6. IndexDatabaseService stores the indexed files in the database
7. IncrementalIndexingService handles subsequent changes to files

### Error Handling

Errors are categorized into the following types:

- `NETWORK`: Network-related errors
- `FILE_SYSTEM`: File system errors (file not found, permission denied, etc.)
- `PERMISSION`: Permission-related errors
- `DATABASE`: Database errors
- `TIMEOUT`: Timeout errors
- `CANCELLED`: Operation cancelled by user
- `UNKNOWN`: Unknown errors

Each error is logged with contextual information to help with debugging.

## Future Improvements

1. **Full-text search**: Implement full-text search capabilities using SQLite's FTS5 extension
2. **Vector embeddings**: Add support for vector embeddings to enable semantic search
3. **File content extraction**: Improve content extraction for different file types (PDF, Office documents, etc.)
4. **Distributed indexing**: Support for distributed indexing across multiple machines
5. **Compression**: Add compression for stored file content to reduce database size
