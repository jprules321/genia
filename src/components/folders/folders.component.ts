import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FoldersService } from '../../providers/folders.service';
import { ElectronWindowService } from '../../providers/electron-window.service';
import { IndexingService, IndexingStatus, IndexationError } from '../../providers/indexing.service';
import { IndexingState } from '../../providers/indexing-status.service';
import { GridAllModule, GridComponent } from '@syncfusion/ej2-angular-grids';
import { ButtonAllModule } from '@syncfusion/ej2-angular-buttons';
import { TextBoxAllModule } from '@syncfusion/ej2-angular-inputs';
import { DialogAllModule, DialogComponent } from '@syncfusion/ej2-angular-popups';
import { Subscription, forkJoin, BehaviorSubject, Observable } from 'rxjs';
import { map, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-folders',
  templateUrl: './folders.component.html',
  styleUrls: ['./folders.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, GridAllModule, ButtonAllModule, TextBoxAllModule, DialogAllModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FoldersComponent implements OnInit, OnDestroy {
  @ViewChild('grid') public grid: GridComponent;
  @ViewChild('editDialog') public editDialog: DialogComponent;
  @ViewChild('addDialog') public addDialog: DialogComponent;
  @ViewChild('errorLogDialog') public errorLogDialog: DialogComponent;

  public folders: Folder[] = [];
  public folders$ = new BehaviorSubject<Folder[]>([]);
  public newFolder: Folder = { id: '', path: '', name: '', createdAt: new Date() };
  public editingFolder: Folder = { id: '', path: '', name: '', createdAt: new Date() };

  // Indexing status
  public indexingStatus: IndexingStatus;
  public indexingStatus$: Observable<IndexingStatus>;
  public isIndexing = false;
  public isIndexing$: Observable<boolean>;
  private subscriptions: Subscription[] = [];
  private statusUpdateInterval: any;

  // Error log
  public errorLogDialogVisible = false;
  public currentErrorLog: IndexationError[] = [];
  public currentErrorFolder: Folder | null = null;
  public errorLogButtons = [
    { click: this.clearErrorLog.bind(this), buttonModel: { content: 'Clear Log', isPrimary: false } },
    { click: this.closeErrorLogDialog.bind(this), buttonModel: { content: 'Close', isPrimary: true } }
  ];

  // Edit Dialog configuration
  public dialogVisible = false;
  public dialogButtons = [
    { click: this.saveEditedFolder.bind(this), buttonModel: { content: 'Save', isPrimary: true } },
    { click: this.closeDialog.bind(this), buttonModel: { content: 'Cancel' } }
  ];

  // Add Dialog configuration
  public addDialogVisible = false;
  public addDialogButtons = [
    { click: this.addFolder.bind(this), buttonModel: { content: 'Add', isPrimary: true } },
    { click: this.closeAddDialog.bind(this), buttonModel: { content: 'Cancel' } }
  ];

  // Grid configuration
  public editSettings = { allowEditing: false, allowAdding: false, allowDeleting: false };
  public toolbar = ['Add', 'Edit', 'Delete', 'Update', 'Cancel'];

  constructor(
    private foldersService: FoldersService,
    private electronWindowService: ElectronWindowService,
    private indexingService: IndexingService,
    private cdr: ChangeDetectorRef
  ) {
    this.indexingStatus = this.indexingService.getIndexingStatus();
    this.indexingStatus$ = this.indexingService.getIndexingStatus$();
    this.isIndexing = [IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(this.indexingStatus.state);
    this.isIndexing$ = this.indexingStatus$.pipe(
      map(status => [IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(status.state))
    );
    this.folders$.next(this.folders);
  }

  ngOnInit(): void {
    // First, check if there are any folders and clear indexed files if none exist
    this.indexingService.clearIndexedFilesIfNoFolders().subscribe(
      cleared => {
        if (cleared) {
          console.log('Cleared indexed files because no folders exist');
        }
        // Continue with normal initialization
        this.loadFolders();
        // Start status update interval
        this.startStatusUpdateInterval();
        // Check for indexation errors
        this.checkFolderErrors();
        // Note: startWatchingFolders is called from loadFolders when folders are loaded
      },
      error => {
        console.error('Error clearing indexed files:', error);
        // Continue with normal initialization even if there was an error
        this.loadFolders();
        this.startStatusUpdateInterval();
        this.checkFolderErrors();
      }
    );
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());

    // Clear status update interval
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
    }
  }

  /**
   * Start an interval to update the indexing status
   */
  private startStatusUpdateInterval(): void {
    // Subscribe to indexing status updates
    const statusSubscription = this.indexingService.getIndexingStatus$()
      .pipe(
        distinctUntilChanged((prev, curr) => {
          // Only trigger update if relevant properties have changed
          return prev.state === curr.state &&
                 prev.progress === curr.progress &&
                 prev.currentFolder === curr.currentFolder;
        })
      )
      .subscribe(newStatus => {
        const wasIndexing = this.isIndexing;
        this.indexingStatus = newStatus;
        this.isIndexing = [IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(newStatus.state);

        // Only update folder progress if indexing is in progress or just completed
        if ((this.isIndexing || wasIndexing !== this.isIndexing) && this.folders && this.folders.length > 0) {
          this.updateFolderIndexingProgress();

          // If indexing just completed, check for errors
          if (wasIndexing && !this.isIndexing) {
            this.checkFolderErrors();
          }
        }

        // Explicitly trigger change detection
        this.cdr.detectChanges();
      });

    // Add subscription to be cleaned up on destroy
    this.subscriptions.push(statusSubscription);

    // Also subscribe to folder statistics updates
    const folderStatsSubscription = this.indexingService.getAllFolderIndexingStats$()
      .subscribe(() => {
        // Update folder progress when stats change
        if (this.folders && this.folders.length > 0) {
          this.updateFolderIndexingProgress();
        }
      });

    // Add subscription to be cleaned up on destroy
    this.subscriptions.push(folderStatsSubscription);

    // Keep a small interval for UI updates that might be missed by the observables
    this.statusUpdateInterval = setInterval(() => {
      if (this.folders && this.folders.length > 0) {
        this.updateFolderIndexingProgress();
      }
    }, 1000); // Less frequent than before since we have observable subscriptions now
  }

  /**
   * Check for indexation errors for all folders
   */
  checkFolderErrors(): void {
    if (this.folders.length === 0) {
      return;
    }

    // Create an array of observables for each folder's error count
    const errorChecks = this.folders.map(folder => {
      return this.indexingService.getFolderErrorCount(folder.path).pipe(
        map(count => {
          return {
            folder,
            errorCount: count,
            hasErrors: count > 0
          };
        })
      );
    });

    // Execute all error checks in parallel
    forkJoin(errorChecks).subscribe(
      results => {
        // Update folders with error information
        this.folders = this.folders.map(folder => {
          const result = results.find(r => r.folder.id === folder.id);
          if (result) {
            return {
              ...folder,
              errorCount: result.errorCount,
              hasErrors: result.hasErrors
            };
          }
          return folder;
        });

        // Explicitly trigger change detection
        this.cdr.detectChanges();
      },
      error => {
        console.error('Error checking folder errors:', error);
      }
    );
  }

  /**
   * Open the error log dialog for a folder
   */
  openErrorLog(folder: Folder): void {
    this.currentErrorFolder = folder;
    this.errorLogDialogVisible = true;

    // Load error log for the folder
    this.indexingService.getIndexationErrors(folder.path).subscribe(
      errors => {
        this.currentErrorLog = errors;
      },
      error => {
        console.error('Error loading error log:', error);
        this.currentErrorLog = [];
      }
    );
  }

  /**
   * Clear the error log for the current folder
   */
  clearErrorLog(): void {
    if (!this.currentErrorFolder) {
      return;
    }

    this.indexingService.clearIndexationErrors(this.currentErrorFolder.path).subscribe(
      success => {
        if (success) {
          this.currentErrorLog = [];
          // Update folder error information
          if (this.currentErrorFolder) {
            const index = this.folders.findIndex(f => f.id === this.currentErrorFolder!.id);
            if (index !== -1) {
              this.folders[index] = {
                ...this.folders[index],
                errorCount: 0,
                hasErrors: false
              };

              // Explicitly trigger change detection
              this.cdr.detectChanges();
            }
            this.currentErrorFolder = {
              ...this.currentErrorFolder,
              errorCount: 0,
              hasErrors: false
            };
          }
        }
      },
      error => {
        console.error('Error clearing error log:', error);
      }
    );
  }

  /**
   * Close the error log dialog
   */
  closeErrorLogDialog(): void {
    this.errorLogDialogVisible = false;
    this.currentErrorLog = [];
    this.currentErrorFolder = null;
  }

  /**
   * Open a directory in the file explorer
   * @param directoryPath Path of the directory to open
   */
  async openDirectory(directoryPath: string): Promise<void> {
    console.log(`Opening directory: ${directoryPath}`);
    try {
      const result = await this.electronWindowService.openDirectory(directoryPath);
      if (result.success) {
        console.log(`Directory opened: ${directoryPath}`);
      } else {
        console.error(`Error opening directory: ${result.error}`);
      }
    } catch (error) {
      console.error('Error opening directory:', error);
    }
  }

  /**
   * Stop ALL folder indexation in progress
   * Also removes the folders indexation data from local storages and marks the Folder as Stopped
   */
  stopIndexation(): void {
    if (!this.isIndexing) {
      return;
    }

    console.log('Stopping ALL folder indexation in progress');

    // Get all folders that are currently being indexed
    const indexingFolders = this.folders.filter(folder =>
      folder.status === 'indexing' ||
      (this.indexingStatus.currentFolder && folder.name === this.indexingStatus.currentFolder)
    );

    // Even if no folders are identified as being indexed, if isIndexing is true,
    // we should still stop the indexation process
    if (indexingFolders.length === 0) {
      console.log('No folders explicitly marked as indexing, but global indexing flag is true. Stopping indexation anyway.');

      // Reset the global indexation status
      this.indexingService.resetIndexingStatus();
      this.isIndexing = false;

      // Update the UI to reflect the changes
      this.updateFolderIndexingProgress();
      return;
    }

    // Stop indexation for each folder
    indexingFolders.forEach(folder => {
      console.log(`Stopping indexation for folder: ${folder.name} (${folder.path})`);

      // Call the indexing service to stop indexation
      this.indexingService.stopFolderIndexation(folder.path).subscribe(
        success => {
          if (success) {
            console.log(`Indexation stopped for folder ${folder.name}`);

            // Mark the folder as stopped in the folder stats
            this.indexingService.updateFolderIndexingStats(folder.id, {
              indexedFiles: folder.indexedFiles || 0,
              totalFiles: folder.totalFiles || 0,
              progress: -1, // -1 indicates stopped
              status: 'stopped'
            });

            // Remove folder indexation data from local storage
            this.indexingService.removeFolderFromIndex(folder).subscribe(
              result => {
                console.log(`Folder ${folder.name} indexation data removed: ${result}`);
              },
              error => {
                console.error(`Error removing folder ${folder.name} indexation data:`, error);
              }
            );
          } else {
            console.error(`Failed to stop indexation for folder ${folder.name}`);
          }
        },
        error => {
          console.error(`Error stopping indexation for folder ${folder.name}:`, error);
        }
      );
    });

    // Reset the global indexation status
    this.indexingService.resetIndexingStatus();
    this.isIndexing = false;

    // Update the UI to reflect the changes
    this.updateFolderIndexingProgress();
  }

  /**
   * Update the indexing progress for each folder
   */
  private updateFolderIndexingProgress(): void {
    // Get all folder stats
    const folderStats = this.indexingService.getAllFolderIndexingStats();
    let hasChanges = false;

    // Create a new array only if there are changes
    const updatedFolders = this.folders.map(folder => {
      // Get the current indexing status
      const indexingStatus = this.indexingService.getIndexingStatus();
      const isCurrentlyIndexing = [IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(indexingStatus.state) && indexingStatus.currentFolder === folder.name;

      // Get folder stats
      const stats = this.indexingService.getFolderIndexingStats(folder.id);

      if (stats) {
        // Calculate progress percentage, accounting for files in queue
        const filesInQueue = stats.filesInQueue || 0;
        let progress = 0;

        if (stats.totalFiles > 0) {
          // If there are files in the queue, cap progress at 99%
          if (filesInQueue > 0) {
            progress = Math.min(99, Math.round((stats.indexedFiles / stats.totalFiles) * 100));
          } else {
            progress = Math.min(100, Math.round((stats.indexedFiles / stats.totalFiles) * 100));
          }
        }

        // Determine folder status
        let status = folder.status;

        // If progress is 100%, mark as indexed
        if (progress === 100) {
          status = 'indexed';
        }
        // If progress is -1, mark as stopped
        else if (progress === -1) {
          status = 'stopped';
        }
        // If folder is currently being indexed, mark as indexing
        else if (isCurrentlyIndexing || filesInQueue > 0) {
          status = 'indexing';
        }
        // If folder has progress but is not currently being indexed, keep previous status or default to indexed
        else if (progress > 0) {
          status = status || 'indexed';
        }

        // Only update if progress or status has changed
        if (progress !== folder.indexingProgress || status !== folder.status ||
            stats.indexedFiles !== folder.indexedFiles || stats.totalFiles !== folder.totalFiles) {
          hasChanges = true;
          return {
            ...folder,
            indexedFiles: stats.indexedFiles,
            totalFiles: stats.totalFiles,
            indexingProgress: progress,
            status: status,
            filesInQueue: filesInQueue
          };
        }
      }
      return folder;
    });

    // Only update this.folders if there were changes
    if (hasChanges) {
      this.folders = updatedFolders;
      this.folders$.next(updatedFolders);
      // No need to explicitly trigger change detection when using observables
    }
  }

  loadFolders(): void {
    this.foldersService.getFolders().subscribe(
      folders => {
        // The service now returns folders with proper Date objects
        this.folders = folders;
        this.folders$.next(folders);

        // Initialize indexing progress for each folder
        this.updateFolderIndexingProgress();

        // Start watching folders if we have any
        if (folders.length > 0) {
          this.startWatchingFolders();
        }

        // No need to explicitly trigger change detection when using observables
      },
      error => {
        console.error('Error loading folders:', error);
      }
    );
  }

  /**
   * Start watching all folders for file changes
   */
  startWatchingFolders(): void {
    if (this.folders.length === 0) {
      console.log('No folders to watch');
      return;
    }

    this.indexingService.startWatchingFolders().subscribe(
      success => {
        console.log('Started watching folders for changes');
      },
      error => {
        console.error('Error starting folder watching:', error);
      }
    );
  }

  async selectFolder(targetFolder: 'new' | 'edit'): Promise<void> {
    try {
      const options = {
        properties: ['openDirectory']
      };

      const result = await this.electronWindowService.showOpenDialog(options);

      if (!result.canceled && result.filePaths.length > 0) {
        const path = result.filePaths[0];
        const name = path.split('\\').pop() || path;

        if (targetFolder === 'new') {
          this.newFolder.path = path;
          this.newFolder.name = name;
        } else {
          this.editingFolder.path = path;
          this.editingFolder.name = name;
        }

        // Explicitly trigger change detection to update the UI
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error selecting folder:', error);
    }
  }

  // Open add folder dialog
  openAddFolderDialog(): void {
    // Check if indexation is in progress using the latest value from the observable
    this.isIndexing$.subscribe(isIndexing => {
      if (isIndexing) {
        alert('Cannot add a folder while indexation is in progress. Please wait for indexation to complete.');
        return;
      }

      // Reset the new folder object
      this.newFolder = { id: '', path: '', name: '', createdAt: new Date() };
      this.addDialogVisible = true;
    }).unsubscribe(); // Immediately unsubscribe to avoid memory leaks
  }

  // Close add folder dialog
  closeAddDialog(): void {
    this.addDialogVisible = false;
  }

  // Add a new folder
  addFolder(): void {
    if (this.newFolder.path) {
      // First check if the folder can be added
      this.foldersService.checkFolderIndexable(this.newFolder.path).subscribe(
        result => {
          if (result.success && result.indexable) {
            // Folder can be added, proceed
            this.addFolderAfterCheck();
          } else {
            // Folder cannot be added, show error
            const reason = result.reason || 'Unknown reason';
            console.error(`Cannot add folder: ${reason}`);

            // Show an alert with the reason
            alert(`Cannot add this folder: ${reason}`);
          }
        },
        error => {
          console.error('Error checking if folder can be added:', error);
          // Show an alert with the error
          alert(`Error checking folder: ${error.toString()}`);
        }
      );
    }
  }

  // Helper method to add a folder after checking it's indexable
  private addFolderAfterCheck(): void {
    // Ensure createdAt is a Date object
    this.newFolder.createdAt = new Date();

    this.foldersService.addFolder(this.newFolder).subscribe(
      folder => {
        // The service now returns folders with proper Date objects
        const updatedFolders = [...this.folders, folder];
        this.folders = updatedFolders;
        this.folders$.next(updatedFolders);

        // Close the dialog
        this.closeAddDialog();

        // Reset form
        this.newFolder = { id: '', path: '', name: '', createdAt: new Date() };

        // Index the new folder
        this.isIndexing = true;
        this.indexingService.indexFolder(folder).subscribe(
          success => {
            console.log(`Folder ${folder.name} indexed successfully`);
            this.isIndexing = false;

            // Update the indexing progress for all folders
            this.updateFolderIndexingProgress();

            // Restart folder watching to include the new folder
            this.startWatchingFolders();
          },
          error => {
            console.error(`Error indexing folder ${folder.name}:`, error);
            this.isIndexing = false;
          }
        );
      },
      error => {
        console.error('Error adding folder:', error);
      }
    );
  }

  // Open edit dialog
  updateFolder(folder: Folder): void {
    this.editingFolder = { ...folder };
    this.dialogVisible = true;
  }

  // Save edited folder
  saveEditedFolder(): void {
    if (this.editingFolder.path) {
      // Preserve the original createdAt date
      const originalFolder = this.folders.find(f => f.id === this.editingFolder.id);
      if (originalFolder) {
        this.editingFolder.createdAt = originalFolder.createdAt;
      }

      // Check if the path has changed
      const pathChanged = originalFolder && originalFolder.path !== this.editingFolder.path;

      // If the path has changed, check if the new path is indexable
      if (pathChanged) {
        this.foldersService.checkFolderIndexable(this.editingFolder.path).subscribe(
          result => {
            if (result.success && result.indexable) {
              // New path is indexable, proceed with update
              this.updateFolderAfterCheck(originalFolder, pathChanged);
            } else {
              // New path is not indexable, show error
              const reason = result.reason || 'Unknown reason';
              console.error(`Cannot update folder path: ${reason}`);

              // Show an alert with the reason
              alert(`Cannot update to this folder path: ${reason}`);
            }
          },
          error => {
            console.error('Error checking if folder can be updated:', error);
            // Show an alert with the error
            alert(`Error checking folder: ${error.toString()}`);
          }
        );
      } else {
        // Path hasn't changed, proceed with update
        this.updateFolderAfterCheck(originalFolder, pathChanged);
      }
    }
  }

  // Helper method to update a folder after checking if it's indexable
  private updateFolderAfterCheck(originalFolder: Folder | undefined, pathChanged: boolean): void {
    this.foldersService.updateFolder(this.editingFolder).subscribe(
      updatedFolder => {
        // The service now returns folders with proper Date objects
        const index = this.folders.findIndex(f => f.id === updatedFolder.id);
        if (index !== -1) {
          const updatedFolders = [
            ...this.folders.slice(0, index),
            updatedFolder,
            ...this.folders.slice(index + 1)
          ];
          this.folders = updatedFolders;
          this.folders$.next(updatedFolders);
        }
        this.closeDialog();

        // If the path changed, we need to re-index the folder
        if (pathChanged) {
          this.isIndexing = true;
          this.indexingService.indexFolder(updatedFolder).subscribe(
            success => {
              console.log(`Folder ${updatedFolder.name} re-indexed successfully`);
              this.isIndexing = false;

              // Update the indexing progress for all folders
              this.updateFolderIndexingProgress();

              // Restart folder watching to update the watched paths
              this.startWatchingFolders();
            },
            error => {
              console.error(`Error re-indexing folder ${updatedFolder.name}:`, error);
              this.isIndexing = false;
            }
          );
        }
      },
      error => {
        console.error('Error updating folder:', error);
      }
    );
  }

  // Close the edit dialog
  closeDialog(): void {
    this.dialogVisible = false;
    this.editingFolder = { id: '', path: '', name: '', createdAt: new Date() };
  }

  deleteFolder(id: string): void {
    // Get the folder before deleting it
    const folderToDelete = this.folders.find(folder => folder.id === id);

    if (!folderToDelete) {
      console.error(`Folder with ID ${id} not found`);
      return;
    }

    // Check if the folder is already being deleted
    if (folderToDelete.deleting) {
      console.log(`Folder ${folderToDelete.name} is already being deleted`);
      return;
    }

    // Mark the folder as being deleted
    const folderIndex = this.folders.findIndex(folder => folder.id === id);
    if (folderIndex !== -1) {
      const updatedFolders = [...this.folders];
      updatedFolders[folderIndex] = {
        ...updatedFolders[folderIndex],
        deleting: true
      };
      this.folders = updatedFolders;
      this.folders$.next(updatedFolders);

      console.log(`UI updated to show folder ${folderToDelete.name} as deleting`);
    }

    // Check if the folder is currently being indexed and stop indexation if needed
    const indexingStatus = this.indexingService.getIndexingStatus();
    if ([IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(indexingStatus.state) && indexingStatus.currentFolder === folderToDelete.name) {
      console.log(`Stopping indexation for folder ${folderToDelete.name} before deletion`);
      this.indexingService.stopFolderIndexation(folderToDelete.path).subscribe(
        success => {
          console.log(`Indexation stopped for folder ${folderToDelete.name}: ${success}`);
          // Continue with folder deletion
          this.performFolderDeletion(id, folderToDelete);
        },
        error => {
          console.error(`Error stopping indexation for folder ${folderToDelete.name}:`, error);
          // Continue with folder deletion anyway
          this.performFolderDeletion(id, folderToDelete);
        }
      );
    } else {
      // If not being indexed, proceed with deletion directly
      this.performFolderDeletion(id, folderToDelete);
    }
  }

  // Helper method to perform the actual folder deletion
  private performFolderDeletion(id: string, folderToDelete: Folder): void {
    console.log(`Starting folder deletion process for folder: ${folderToDelete.name} (${folderToDelete.path})`);

    // Mark the folder as being deleted in the UI
    // We'll keep the folder in the list until after we've removed it from the index
    // This ensures the folder ID is still available when we need to clear indexed files
    console.log(`Marking folder ${folderToDelete.name} as being deleted...`);
    const folderIndex = this.folders.findIndex(folder => folder.id === id);
    if (folderIndex !== -1) {
      const updatedFolders = [...this.folders];
      updatedFolders[folderIndex] = {
        ...updatedFolders[folderIndex],
        deleting: true
      };
      this.folders = updatedFolders;
      this.folders$.next(updatedFolders);
    }

    console.log(`UI updated to mark folder ${folderToDelete.name} as being deleted`);

    // First remove folder from index (clears indexed files and stops watching)
    // This ensures indexed files are deleted from the database before the folder is deleted
    this.indexingService.removeFolderFromIndex(folderToDelete).subscribe(
      result => {
        console.log(`Folder ${folderToDelete.name} removed from index: ${result}`);

        // Now delete the folder from the service
        console.log(`Deleting folder ${folderToDelete.name} from service...`);
        this.foldersService.deleteFolder(id).subscribe(
          success => {
            console.log(`Folder ${folderToDelete.name} deletion from service result: ${success}`);
            if (success) {
              // Now that the folder has been removed from the index and deleted from the service,
              // we can safely remove it from the UI list
              console.log(`Removing folder ${folderToDelete.name} from UI list...`);
              console.log(`Before removal, folders count: ${this.folders.length}`);
              const updatedFolders = this.folders.filter(folder => folder.id !== id);
              this.folders = updatedFolders;
              this.folders$.next(updatedFolders);
              console.log(`After removal, folders count: ${this.folders.length}`);

              // Remove folder indexing stats
              this.indexingService.removeFolderIndexingStats(folderToDelete.id);
              console.log(`Removed indexing stats for folder ${folderToDelete.name}`);

              // Check if this was the folder being indexed and reset global indexation status if needed
              const indexingStatus = this.indexingService.getIndexingStatus();
              if ([IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(indexingStatus.state) && indexingStatus.currentFolder === folderToDelete.name) {
                // Reset the global indexation status
                console.log(`Resetting global indexation status for folder ${folderToDelete.name}`);
                this.indexingService.resetIndexingStatus();
                this.isIndexing = false;
              }

              // Restart folder watching to update the watched paths
              console.log(`Restarting folder watching...`);
              this.startWatchingFolders();

              console.log(`Folder ${folderToDelete.name} removed from watching`);

              // Force change detection to update the UI
              setTimeout(() => {
                console.log(`Folder deletion process completed for ${folderToDelete.name}`);
                console.log(`Current folders in list: ${this.folders.map(f => f.name).join(', ')}`);
              }, 100);
            } else {
              console.error(`Failed to delete folder ${folderToDelete.name} from service`);
            }
          },
          error => {
            console.error('Error deleting folder:', error);
          }
        );
      },
      error => {
        console.error(`Error removing folder ${folderToDelete.name} from index:`, error);
        // Continue with folder deletion even if removing from index fails
        console.log(`Continuing with folder deletion despite index removal error...`);
        this.foldersService.deleteFolder(id).subscribe(
          success => {
            console.log(`Folder ${folderToDelete.name} deletion from service result: ${success}`);
            if (success) {
              // Now that the folder has been deleted from the service,
              // we can safely remove it from the UI list
              console.log(`Removing folder ${folderToDelete.name} from UI list...`);
              console.log(`Before removal, folders count: ${this.folders.length}`);
              const updatedFolders = this.folders.filter(folder => folder.id !== id);
              this.folders = updatedFolders;
              this.folders$.next(updatedFolders);
              console.log(`After removal, folders count: ${this.folders.length}`);

              // Remove folder indexing stats
              this.indexingService.removeFolderIndexingStats(folderToDelete.id);
              console.log(`Removed indexing stats for folder ${folderToDelete.name}`);

              // Check if this was the folder being indexed and reset global indexation status if needed
              const indexingStatus = this.indexingService.getIndexingStatus();
              if ([IndexingState.INITIALIZING, IndexingState.COUNTING_FILES, IndexingState.INDEXING].includes(indexingStatus.state) && indexingStatus.currentFolder === folderToDelete.name) {
                // Reset the global indexation status
                console.log(`Resetting global indexation status for folder ${folderToDelete.name}`);
                this.indexingService.resetIndexingStatus();
                this.isIndexing = false;
              }

              // Restart folder watching to update the watched paths
              console.log(`Restarting folder watching...`);
              this.startWatchingFolders();

              console.log(`Folder ${folderToDelete.name} removed from watching`);

              // Force change detection to update the UI
              setTimeout(() => {
                console.log(`Folder deletion process completed for ${folderToDelete.name}`);
                console.log(`Current folders in list: ${this.folders.map(f => f.name).join(', ')}`);
              }, 100);
            } else {
              console.error(`Failed to delete folder ${folderToDelete.name} from service`);
            }
          },
          error => {
            console.error('Error deleting folder:', error);
          }
        );
      }
    );
  }
}

// Folder model
export interface Folder {
  id: string;
  path: string;
  name: string;
  createdAt: Date;
  indexedFiles?: number;
  totalFiles?: number;
  indexingProgress?: number;
  errorCount?: number;
  hasErrors?: boolean;
  status?: 'indexed' | 'indexing' | 'stopped';
  deleting?: boolean;
  filesInQueue?: number; // Number of files waiting to be saved to the database
}
