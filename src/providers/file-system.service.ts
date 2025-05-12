import { Injectable } from '@angular/core';
import { Observable, from, of, throwError, timer } from 'rxjs';
import { map, catchError, mergeMap, retry, retryWhen, delayWhen, tap, concatMap } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';
import { IndexingSettingsService } from './indexing-settings.service';

/**
 * Service responsible for file system operations related to indexing
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class FileSystemService {
  constructor(
    private electronWindowService: ElectronWindowService,
    private indexingSettingsService: IndexingSettingsService
  ) {}

  /**
   * Check if a folder is indexable
   * @param folderPath Path of the folder to check
   */
  isFolderIndexable(folderPath: string): Observable<{ indexable: boolean, reason?: string }> {
    return from(this.electronWindowService.checkFolderIndexable(folderPath)).pipe(
      map(result => {
        if (result.success) {
          return {
            indexable: result.indexable,
            reason: result.reason
          };
        } else {
          console.error(`Error checking if folder ${folderPath} is indexable:`, result.error);
          return {
            indexable: false,
            reason: result.error || 'Unknown error'
          };
        }
      }),
      catchError(error => {
        console.error(`Error checking if folder ${folderPath} is indexable:`, error);
        return of({
          indexable: false,
          reason: error.toString()
        });
      })
    );
  }

  /**
   * Get all files in a folder with robust error handling and retry logic
   * @param folderPath Path of the folder
   * @param recursive Whether to include files in subfolders
   * @param skipHidden Whether to skip hidden files and folders
   */
  getFilesInFolder(folderPath: string, recursive: boolean = true, skipHidden: boolean = true): Observable<string[]> {
    const settings = this.indexingSettingsService.getSettings();

    return from(this.electronWindowService.listFilesInDirectory(folderPath, recursive)).pipe(
      map(result => {
        if (result.success) {
          // Filter files based on settings
          return result.files.filter(filePath => {
            // Skip files that match excluded patterns
            if (this.indexingSettingsService.shouldExcludeByPattern(filePath)) {
              return false;
            }

            // Skip files with excluded extensions
            if (this.indexingSettingsService.shouldExcludeByExtension(filePath)) {
              return false;
            }

            // Skip hidden files if configured to do so
            const isHidden = filePath.split(/[\/\\]/).some(part => part.startsWith('.'));
            if (skipHidden && isHidden && !settings.indexHiddenFiles) {
              return false;
            }

            return true;
          });
        } else {
          console.error(`Error listing files in directory ${folderPath}:`, result.error);
          return [];
        }
      }),
      // Implement retry logic with exponential backoff
      retryWhen(errors =>
        errors.pipe(
          // Log the error
          tap(error => console.error(`Error getting files in folder ${folderPath}, retrying:`, error)),
          // Retry with delay
          concatMap((error, i) => {
            const retryAttempt = i + 1;
            // Max retries from settings
            if (retryAttempt > settings.maxRetries) {
              return throwError(error);
            }
            // Exponential backoff
            const delay = retryAttempt * settings.retryDelayMs;
            console.log(`Retrying after ${delay}ms (attempt ${retryAttempt}/${settings.maxRetries})`);
            return timer(delay);
          })
        )
      ),
      catchError(error => {
        console.error(`Error getting files in folder ${folderPath} after retries:`, error);
        // Return empty array instead of throwing to allow partial indexing
        return of([]);
      })
    );
  }

  /**
   * Traverse a directory recursively with robust error handling
   * @param folderPath Path of the folder to traverse
   * @param onFile Callback for each file found
   * @param onError Callback for errors
   * @param skipHidden Whether to skip hidden files and folders
   */
  traverseDirectory(
    folderPath: string,
    onFile: (filePath: string) => void,
    onError: (error: any, path: string) => void,
    skipHidden: boolean = true
  ): Observable<boolean> {
    return new Observable<boolean>(subscriber => {
      const settings = this.indexingSettingsService.getSettings();
      const visitedDirs = new Set<string>();

      const processDirectory = (dirPath: string): Promise<void> => {
        // Avoid cycles in directory structure
        if (visitedDirs.has(dirPath)) {
          return Promise.resolve();
        }

        visitedDirs.add(dirPath);

        return this.electronWindowService.listFilesAndDirs(dirPath)
          .then(result => {
            if (!result.success) {
              throw new Error(result.error || `Failed to list contents of ${dirPath}`);
            }

            const { files, directories } = result;

            // Process files
            for (const filePath of files) {
              // Skip files that match excluded patterns
              if (this.indexingSettingsService.shouldExcludeByPattern(filePath)) {
                continue;
              }

              // Skip files with excluded extensions
              if (this.indexingSettingsService.shouldExcludeByExtension(filePath)) {
                continue;
              }

              // Skip hidden files if configured to do so
              const fileName = filePath.split(/[\/\\]/).pop() || '';
              if (skipHidden && fileName.startsWith('.') && !settings.indexHiddenFiles) {
                continue;
              }

              try {
                onFile(filePath);
              } catch (error) {
                onError(error, filePath);
              }
            }

            // Process subdirectories
            return Promise.all(
              directories.map(dirPath => {
                // Skip directories that match excluded patterns
                if (this.indexingSettingsService.shouldExcludeByPattern(dirPath)) {
                  return Promise.resolve();
                }

                // Skip hidden directories if configured to do so
                const dirName = dirPath.split(/[\/\\]/).pop() || '';
                if (skipHidden && dirName.startsWith('.') && !settings.indexHiddenFiles) {
                  return Promise.resolve();
                }

                // Process subdirectory with error handling
                return processDirectory(dirPath).catch(error => {
                  onError(error, dirPath);
                  // Continue with other directories even if one fails
                  return Promise.resolve();
                });
              })
            ).then(() => {
              // Return void to match the Promise<void> return type
              return;
            });
          });
      };

      processDirectory(folderPath)
        .then(() => {
          subscriber.next(true);
          subscriber.complete();
        })
        .catch(error => {
          onError(error, folderPath);
          // Complete with success even if there are errors to allow partial indexing
          subscriber.next(true);
          subscriber.complete();
        });

      // Return cleanup function
      return () => {
        // Nothing to clean up
      };
    });
  }

  /**
   * Get file stats (size, modification time, etc.) with size limit checking
   * @param filePath Path of the file
   */
  getFileStats(filePath: string): Observable<{
    size: number,
    lastModified: Date,
    isDirectory: boolean,
    isFile: boolean,
    isIndexable: boolean,
    skipReason?: string
  }> {
    const settings = this.indexingSettingsService.getSettings();

    return from(this.electronWindowService.getFileStats(filePath)).pipe(
      map(result => {
        if (result.success) {
          const stats = result.stats;
          let isIndexable = true;
          let skipReason: string | undefined;

          // Check if file should be excluded based on size
          if (this.indexingSettingsService.shouldExcludeBySize(stats.size)) {
            isIndexable = false;
            skipReason = `File exceeds maximum size limit of ${settings.maxFileSizeBytes / (1024 * 1024)}MB`;
          }

          // Check if file should be excluded based on extension
          if (isIndexable && this.indexingSettingsService.shouldExcludeByExtension(filePath)) {
            isIndexable = false;
            skipReason = 'File extension is excluded by settings';
          }

          // Check if file should be excluded based on pattern
          if (isIndexable && this.indexingSettingsService.shouldExcludeByPattern(filePath)) {
            isIndexable = false;
            skipReason = 'File matches an excluded pattern';
          }

          // Check if file should be excluded based on hidden status
          const fileName = filePath.split(/[\/\\]/).pop() || '';
          const isHidden = fileName.startsWith('.');
          if (isIndexable && this.indexingSettingsService.shouldExcludeHidden(isHidden)) {
            isIndexable = false;
            skipReason = 'File is hidden and hidden files are excluded by settings';
          }

          return {
            size: stats.size,
            lastModified: new Date(stats.mtime),
            isDirectory: stats.isDirectory,
            isFile: stats.isFile,
            isIndexable,
            skipReason
          };
        } else {
          console.error(`Error getting stats for file ${filePath}:`, result.error);
          throw new Error(result.error || `Failed to get stats for ${filePath}`);
        }
      }),
      // Implement retry logic with exponential backoff
      retryWhen(errors =>
        errors.pipe(
          // Log the error
          tap(error => console.error(`Error getting stats for file ${filePath}, retrying:`, error)),
          // Retry with delay
          concatMap((error, i) => {
            const retryAttempt = i + 1;
            // Max retries from settings
            if (retryAttempt > settings.maxRetries) {
              return throwError(error);
            }
            // Exponential backoff
            const delay = retryAttempt * settings.retryDelayMs;
            console.log(`Retrying after ${delay}ms (attempt ${retryAttempt}/${settings.maxRetries})`);
            return timer(delay);
          })
        )
      ),
      catchError(error => {
        console.error(`Error getting stats for file ${filePath} after retries:`, error);
        throw error;
      })
    );
  }

  /**
   * Check if a file is indexable based on settings
   * @param filePath Path to the file
   */
  isFileIndexable(filePath: string): Observable<{ indexable: boolean, reason?: string }> {
    return this.getFileStats(filePath).pipe(
      map(stats => {
        return {
          indexable: stats.isIndexable,
          reason: stats.skipReason
        };
      }),
      catchError(error => {
        return of({
          indexable: false,
          reason: `Error checking file: ${error.message || error}`
        });
      })
    );
  }

  /**
   * Read a file's content
   * @param filePath Path of the file
   */
  readFileContent(filePath: string): Observable<string> {
    // This would call the Electron main process to read the file
    // For now, we'll just return a placeholder
    return of(`Sample content for ${filePath}`).pipe(
      catchError(error => {
        console.error(`Error reading file ${filePath}:`, error);
        throw error;
      })
    );
  }

  /**
   * Watch a folder for changes with filtering based on settings
   * @param folderPath Path of the folder to watch
   * @param recursive Whether to watch subfolders recursively
   */
  watchFolder(folderPath: string, recursive: boolean = true): Observable<{
    type: 'add' | 'change' | 'unlink',
    path: string,
    stats?: {
      size: number,
      lastModified: Date,
      isDirectory: boolean,
      isFile: boolean
    }
  }> {
    const settings = this.indexingSettingsService.getSettings();

    return new Observable(subscriber => {
      console.log(`Started watching folder: ${folderPath}`);

      // Track active watch to avoid duplicate events
      let isWatchActive = true;

      // Set up file watcher through Electron
      this.electronWindowService.watchFolder(folderPath, recursive)
        .then(result => {
          if (!result.success) {
            subscriber.error(new Error(result.error || `Failed to watch folder: ${folderPath}`));
            return;
          }

          // Set up event listener for file changes
          const handleFileChange = (event: any) => {
            if (!isWatchActive) return;

            const { type, path } = event;

            // Skip files that match excluded patterns
            if (this.indexingSettingsService.shouldExcludeByPattern(path)) {
              return;
            }

            // Skip files with excluded extensions (only for add/change events)
            if ((type === 'add' || type === 'change') &&
                this.indexingSettingsService.shouldExcludeByExtension(path)) {
              return;
            }

            // For add/change events, get file stats to check size and provide additional info
            if (type === 'add' || type === 'change') {
              this.getFileStats(path).subscribe({
                next: stats => {
                  // Skip files that exceed size limit
                  if (!stats.isIndexable) {
                    return;
                  }

                  subscriber.next({
                    type,
                    path,
                    stats: {
                      size: stats.size,
                      lastModified: stats.lastModified,
                      isDirectory: stats.isDirectory,
                      isFile: stats.isFile
                    }
                  });
                },
                error: error => {
                  console.error(`Error getting stats for changed file ${path}:`, error);
                  // Still emit the event without stats
                  subscriber.next({ type, path });
                }
              });
            } else {
              // For unlink events, just emit the event
              subscriber.next({ type, path });
            }
          };

          // Register the event listener
          this.electronWindowService.onFileChange(handleFileChange);
        })
        .catch(error => {
          subscriber.error(error);
        });

      // Return cleanup function
      return () => {
        console.log(`Stopped watching folder: ${folderPath}`);
        isWatchActive = false;
        this.electronWindowService.unwatchFolder(folderPath)
          .catch(error => {
            console.error(`Error unwatching folder ${folderPath}:`, error);
          });
      };
    });
  }

  /**
   * Get file change events for a specific file
   * @param filePath Path of the file to watch
   */
  watchFile(filePath: string): Observable<{
    type: 'change' | 'unlink',
    path: string,
    stats?: {
      size: number,
      lastModified: Date
    }
  }> {
    return new Observable(subscriber => {
      console.log(`Started watching file: ${filePath}`);

      // Track active watch to avoid duplicate events
      let isWatchActive = true;

      // Set up file watcher through Electron
      this.electronWindowService.watchFile(filePath)
        .then(result => {
          if (!result.success) {
            subscriber.error(new Error(result.error || `Failed to watch file: ${filePath}`));
            return;
          }

          // Set up event listener for file changes
          const handleFileChange = (event: any) => {
            if (!isWatchActive) return;

            const { type, path } = event;

            // Only process events for this specific file
            if (path !== filePath) return;

            // For change events, get file stats to provide additional info
            if (type === 'change') {
              this.getFileStats(path).subscribe({
                next: stats => {
                  subscriber.next({
                    type,
                    path,
                    stats: {
                      size: stats.size,
                      lastModified: stats.lastModified
                    }
                  });
                },
                error: error => {
                  console.error(`Error getting stats for changed file ${path}:`, error);
                  // Still emit the event without stats
                  subscriber.next({ type, path });
                }
              });
            } else if (type === 'unlink') {
              // For unlink events, just emit the event
              subscriber.next({ type, path });
            }
          };

          // Register the event listener
          this.electronWindowService.onFileChange(handleFileChange);
        })
        .catch(error => {
          subscriber.error(error);
        });

      // Return cleanup function
      return () => {
        console.log(`Stopped watching file: ${filePath}`);
        isWatchActive = false;
        this.electronWindowService.unwatchFile(filePath)
          .catch(error => {
            console.error(`Error unwatching file ${filePath}:`, error);
          });
      };
    });
  }

  // Track active folder watchers
  private activeWatchers: Map<string, { subscription: any, id: string }> = new Map();

  /**
   * Start watching multiple folders with enhanced change detection
   * @param folderPaths Array of folder objects with id and path properties
   * @param onFileChange Optional callback for file change events
   */
  startWatchingFolders(
    folderPaths: { id: string; path: string; }[],
    onFileChange?: (event: { type: string, path: string, folderId: string, stats?: any }) => void
  ): Observable<boolean> {
    // First stop any existing watchers
    this.stopWatchingFolders();

    return new Observable<boolean>(subscriber => {
      try {
        console.log(`Starting to watch ${folderPaths.length} folders`);

        // Start watching each folder
        for (const folder of folderPaths) {
          // Skip if already watching this folder
          if (this.activeWatchers.has(folder.path)) {
            continue;
          }

          // Start watching this folder
          const subscription = this.watchFolder(folder.path, true).subscribe({
            next: (event) => {
              console.log(`File change detected in folder ${folder.path}: ${event.type} ${event.path}`);

              // Call the callback if provided
              if (onFileChange) {
                onFileChange({
                  ...event,
                  folderId: folder.id
                });
              }
            },
            error: (error) => {
              console.error(`Error watching folder ${folder.path}:`, error);
            }
          });

          // Store the subscription
          this.activeWatchers.set(folder.path, {
            subscription,
            id: folder.id
          });
        }

        console.log(`Now watching ${this.activeWatchers.size} folders`);
        subscriber.next(true);
        subscriber.complete();
      } catch (error) {
        console.error('Error starting folder watching:', error);
        subscriber.next(false);
        subscriber.complete();
      }
    });
  }

  /**
   * Stop watching all folders
   */
  stopWatchingFolders(): Observable<boolean> {
    return new Observable<boolean>(subscriber => {
      try {
        const watcherCount = this.activeWatchers.size;

        if (watcherCount === 0) {
          console.log('No active folder watchers to stop');
          subscriber.next(true);
          subscriber.complete();
          return;
        }

        console.log(`Stopping ${watcherCount} folder watchers`);

        // Unsubscribe from all watchers
        for (const [path, watcher] of this.activeWatchers.entries()) {
          try {
            watcher.subscription.unsubscribe();
            console.log(`Stopped watching folder: ${path}`);
          } catch (error) {
            console.error(`Error stopping watcher for folder ${path}:`, error);
          }
        }

        // Clear the watchers map
        this.activeWatchers.clear();

        console.log('Stopped watching all folders');
        subscriber.next(true);
        subscriber.complete();
      } catch (error) {
        console.error('Error stopping folder watching:', error);
        subscriber.next(false);
        subscriber.complete();
      }
    });
  }

  /**
   * Stop watching a specific folder
   * @param folderPath Path of the folder to stop watching
   */
  stopWatchingFolder(folderPath: string): Observable<boolean> {
    return new Observable<boolean>(subscriber => {
      try {
        const watcher = this.activeWatchers.get(folderPath);

        if (!watcher) {
          console.log(`No active watcher for folder: ${folderPath}`);
          subscriber.next(true);
          subscriber.complete();
          return;
        }

        // Unsubscribe from the watcher
        try {
          watcher.subscription.unsubscribe();
          console.log(`Stopped watching folder: ${folderPath}`);
        } catch (error) {
          console.error(`Error stopping watcher for folder ${folderPath}:`, error);
          subscriber.next(false);
          subscriber.complete();
          return;
        }

        // Remove from the watchers map
        this.activeWatchers.delete(folderPath);

        subscriber.next(true);
        subscriber.complete();
      } catch (error) {
        console.error(`Error stopping watcher for folder ${folderPath}:`, error);
        subscriber.next(false);
        subscriber.complete();
      }
    });
  }

  /**
   * Open a folder in the system file explorer
   * @param folderPath Path of the folder to open
   */
  openFolder(folderPath: string): Observable<boolean> {
    return from(this.electronWindowService.openDirectory(folderPath)).pipe(
      map(result => {
        if (result.success) {
          console.log(`Opened folder: ${folderPath}`);
          return true;
        } else {
          console.error(`Error opening folder ${folderPath}:`, result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error(`Error opening folder ${folderPath}:`, error);
        return of(false);
      })
    );
  }
}
