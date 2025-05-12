import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { map, catchError, tap, finalize, mergeMap, concatMap } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';

/**
 * Interface for file reading options
 */
export interface FileReadOptions {
  chunkSize?: number;        // Size of chunks to read in bytes
  useStreaming?: boolean;    // Whether to use streaming for large files
  cacheResults?: boolean;    // Whether to cache results
  encoding?: string;         // File encoding (utf8, ascii, etc.)
  maxSize?: number;          // Maximum file size to read in bytes
  skipBinary?: boolean;      // Whether to skip binary files
}

/**
 * Interface for file chunk
 */
export interface FileChunk {
  content: string;
  start: number;
  end: number;
  isLastChunk: boolean;
}

/**
 * Service responsible for optimized file reading
 * This service is used to improve performance by optimizing file reading operations
 */
@Injectable({
  providedIn: 'root'
})
export class OptimizedFileReaderService {
  // Default options
  private defaultOptions: FileReadOptions = {
    chunkSize: 1024 * 1024,  // 1MB chunks
    useStreaming: true,      // Use streaming for large files
    cacheResults: true,      // Cache results
    encoding: 'utf8',        // Default to UTF-8
    maxSize: 50 * 1024 * 1024, // 50MB max file size
    skipBinary: true         // Skip binary files
  };

  // Cache for file contents
  private fileCache: Map<string, {
    content: string,
    timestamp: number,
    size: number
  }> = new Map();

  // Maximum cache size (100MB)
  private maxCacheSize = 100 * 1024 * 1024;

  // Current cache size
  private currentCacheSize = 0;

  constructor(
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Read a file with optimized performance
   * @param filePath Path to the file
   * @param options Reading options
   * @returns Observable of file content
   */
  readFile(filePath: string, options?: Partial<FileReadOptions>): Observable<string> {
    // Merge options with defaults
    const mergedOptions: FileReadOptions = {
      ...this.defaultOptions,
      ...options
    };

    // Check cache first if caching is enabled
    if (mergedOptions.cacheResults && this.fileCache.has(filePath)) {
      const cachedFile = this.fileCache.get(filePath)!;
      console.log(`Using cached content for file: ${filePath}`);
      return of(cachedFile.content);
    }

    // Get file stats to check size
    return from(this.electronWindowService.getFileStats(filePath)).pipe(
      mergeMap(result => {
        if (!result.success) {
          return throwError(() => new Error(result.error || `Failed to get stats for file: ${filePath}`));
        }

        const stats = result.stats;

        // Check if file is too large
        if (stats.size > mergedOptions.maxSize!) {
          return throwError(() => new Error(`File is too large: ${stats.size} bytes (max: ${mergedOptions.maxSize} bytes)`));
        }

        // Check if file is binary (if skipBinary is true)
        if (mergedOptions.skipBinary && this.isBinaryPath(filePath)) {
          return throwError(() => new Error(`Skipping binary file: ${filePath}`));
        }

        // For small files, read the entire file at once
        if (stats.size < mergedOptions.chunkSize! || !mergedOptions.useStreaming) {
          return this.readEntireFile(filePath, mergedOptions);
        }

        // For large files, use streaming
        return this.readFileInChunks(filePath, stats.size, mergedOptions);
      }),
      catchError(error => {
        console.error(`Error reading file ${filePath}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Read a file in chunks
   * @param filePath Path to the file
   * @param fileSize Size of the file in bytes
   * @param options Reading options
   * @returns Observable of file content
   */
  private readFileInChunks(filePath: string, fileSize: number, options: FileReadOptions): Observable<string> {
    console.log(`Reading file in chunks: ${filePath} (${fileSize} bytes)`);

    const chunkSize = options.chunkSize!;
    const numChunks = Math.ceil(fileSize / chunkSize);
    let content = '';

    // Read chunks sequentially
    return new Observable<string>(subscriber => {
      const readNextChunk = (chunkIndex: number) => {
        if (chunkIndex >= numChunks) {
          // All chunks read
          if (options.cacheResults) {
            this.cacheFileContent(filePath, content, fileSize);
          }

          subscriber.next(content);
          subscriber.complete();
          return;
        }

        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, fileSize);

        this.readFileChunk(filePath, start, end, options).subscribe({
          next: (chunk) => {
            content += chunk.content;

            // Report progress
            const progress = Math.round((chunkIndex + 1) / numChunks * 100);
            console.log(`Reading ${filePath}: ${progress}% (chunk ${chunkIndex + 1}/${numChunks})`);

            // Read next chunk
            readNextChunk(chunkIndex + 1);
          },
          error: (error) => {
            console.error(`Error reading chunk ${chunkIndex} of file ${filePath}:`, error);
            subscriber.error(error);
          }
        });
      };

      // Start reading chunks
      readNextChunk(0);
    });
  }

  /**
   * Read a specific chunk of a file
   * @param filePath Path to the file
   * @param start Start position in bytes
   * @param end End position in bytes
   * @param options Reading options
   * @returns Observable of file chunk
   */
  private readFileChunk(filePath: string, start: number, end: number, options: FileReadOptions): Observable<FileChunk> {
    return from(this.electronWindowService.readFileChunk(filePath, start, end, options.encoding!)).pipe(
      map(result => {
        if (!result.success) {
          throw new Error(result.error || `Failed to read chunk of file: ${filePath}`);
        }

        return {
          content: result.content,
          start,
          end,
          isLastChunk: end >= result.fileSize
        };
      }),
      catchError(error => {
        console.error(`Error reading chunk of file ${filePath}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Read an entire file at once
   * @param filePath Path to the file
   * @param options Reading options
   * @returns Observable of file content
   */
  private readEntireFile(filePath: string, options: FileReadOptions): Observable<string> {
    console.log(`Reading entire file: ${filePath}`);

    return from(this.electronWindowService.readFile(filePath, options.encoding!)).pipe(
      map(result => {
        if (!result.success) {
          throw new Error(result.error || `Failed to read file: ${filePath}`);
        }

        const content = result.content;

        // Cache the content if caching is enabled
        if (options.cacheResults) {
          this.cacheFileContent(filePath, content, result.size);
        }

        return content;
      }),
      catchError(error => {
        console.error(`Error reading file ${filePath}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Cache file content
   * @param filePath Path to the file
   * @param content File content
   * @param fileSize Size of the file in bytes
   */
  private cacheFileContent(filePath: string, content: string, fileSize: number): void {
    // Check if we need to make room in the cache
    if (this.currentCacheSize + fileSize > this.maxCacheSize) {
      this.evictFromCache(fileSize);
    }

    // Add to cache
    this.fileCache.set(filePath, {
      content,
      timestamp: Date.now(),
      size: fileSize
    });

    this.currentCacheSize += fileSize;
    console.log(`Cached file ${filePath} (${fileSize} bytes). Cache size: ${this.currentCacheSize} bytes`);
  }

  /**
   * Evict files from cache to make room
   * @param neededSpace Space needed in bytes
   */
  private evictFromCache(neededSpace: number): void {
    // If cache is empty or we need more space than the max cache size, clear the cache
    if (this.fileCache.size === 0 || neededSpace > this.maxCacheSize) {
      this.clearCache();
      return;
    }

    // Sort cache entries by timestamp (oldest first)
    const entries = Array.from(this.fileCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Remove entries until we have enough space
    let freedSpace = 0;
    for (const [path, entry] of entries) {
      this.fileCache.delete(path);
      freedSpace += entry.size;
      this.currentCacheSize -= entry.size;

      console.log(`Evicted ${path} from cache (${entry.size} bytes)`);

      if (freedSpace >= neededSpace) {
        break;
      }
    }
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.fileCache.clear();
    this.currentCacheSize = 0;
    console.log('File cache cleared');
  }

  /**
   * Check if a file is likely binary based on its extension
   * @param filePath Path to the file
   * @returns True if the file is likely binary
   */
  private isBinaryPath(filePath: string): boolean {
    const binaryExtensions = [
      // Images
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.ico',
      // Audio
      '.mp3', '.wav', '.ogg', '.flac', '.aac',
      // Video
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv',
      // Archives
      '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
      // Documents
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      // Executables
      '.exe', '.dll', '.so', '.dylib',
      // Other
      '.bin', '.dat', '.db', '.sqlite', '.class'
    ];

    const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    return binaryExtensions.includes(extension);
  }

  /**
   * Set the maximum cache size
   * @param sizeInMB Maximum cache size in megabytes
   */
  setMaxCacheSize(sizeInMB: number): void {
    this.maxCacheSize = Math.max(1, sizeInMB) * 1024 * 1024;

    // If current cache is larger than new max, evict some entries
    if (this.currentCacheSize > this.maxCacheSize) {
      this.evictFromCache(this.currentCacheSize - this.maxCacheSize);
    }
  }

  /**
   * Get the current cache statistics
   * @returns Cache statistics
   */
  getCacheStats(): {
    cacheSize: number,
    maxCacheSize: number,
    cacheEntries: number,
    usagePercent: number
  } {
    return {
      cacheSize: this.currentCacheSize,
      maxCacheSize: this.maxCacheSize,
      cacheEntries: this.fileCache.size,
      usagePercent: (this.currentCacheSize / this.maxCacheSize) * 100
    };
  }

  /**
   * Check if a file is in the cache
   * @param filePath Path to the file
   * @returns True if the file is in the cache
   */
  isFileCached(filePath: string): boolean {
    return this.fileCache.has(filePath);
  }

  /**
   * Remove a specific file from the cache
   * @param filePath Path to the file
   */
  removeFromCache(filePath: string): void {
    if (this.fileCache.has(filePath)) {
      const entry = this.fileCache.get(filePath)!;
      this.fileCache.delete(filePath);
      this.currentCacheSize -= entry.size;
      console.log(`Removed ${filePath} from cache (${entry.size} bytes)`);
    }
  }
}
