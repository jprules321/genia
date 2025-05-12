import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { IPCService } from '../../providers/ipc.service';

/**
 * Example component demonstrating the use of the enhanced IPCService
 *
 * This component shows how to use the IPCService for various IPC operations
 * with improved error handling, validation, and logging.
 */
@Component({
  selector: 'app-ipc-example',
  template: `
    <div class="container">
      <h2>IPC Communication Example</h2>

      <div class="card mb-3">
        <div class="card-header">Window Operations</div>
        <div class="card-body">
          <button class="btn btn-primary me-2" (click)="checkMaximized()">Check Maximized</button>
          <button class="btn btn-primary me-2" (click)="toggleMaximize()">Toggle Maximize</button>
          <p *ngIf="isMaximized !== null">Window is {{ isMaximized ? 'maximized' : 'not maximized' }}</p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">File Operations</div>
        <div class="card-body">
          <button class="btn btn-primary me-2" (click)="openFileDialog()">Open File Dialog</button>
          <button class="btn btn-primary me-2" (click)="getDatabasePath()">Get Database Path</button>
          <p *ngIf="selectedFiles.length > 0">
            Selected files:
            <ul>
              <li *ngFor="let file of selectedFiles">{{ file }}</li>
            </ul>
          </p>
          <p *ngIf="databasePath">Database path: {{ databasePath }}</p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">Indexation Progress</div>
        <div class="card-body">
          <div *ngIf="indexationProgress">
            <p>Folder: {{ indexationProgress.folderPath }}</p>
            <p>Progress: {{ indexationProgress.progress }}%</p>
            <p>Files: {{ indexationProgress.indexedFiles }} / {{ indexationProgress.totalFiles }}</p>
            <p>Status: {{ indexationProgress.status }}</p>
          </div>
          <p *ngIf="!indexationProgress">No indexation in progress</p>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">Error Handling Example</div>
        <div class="card-body">
          <button class="btn btn-primary me-2" (click)="triggerError()">Trigger Error</button>
          <p *ngIf="errorMessage" class="text-danger">{{ errorMessage }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .container {
      padding: 20px;
    }
    .card {
      margin-bottom: 20px;
    }
  `]
})
export class IPCExampleComponent implements OnInit, OnDestroy {
  // Flag to track if window is maximized
  isMaximized: boolean | null = null;

  // Selected files from file dialog
  selectedFiles: string[] = [];

  // Database path
  databasePath: string | null = null;

  // Latest indexation progress
  indexationProgress: any = null;

  // Error message
  errorMessage: string | null = null;

  // Subject for unsubscribing from observables
  private destroy$ = new Subject<void>();

  constructor(private ipcService: IPCService) {}

  ngOnInit(): void {
    // Subscribe to indexation progress updates
    this.ipcService.indexationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.indexationProgress = progress;
        console.log('Indexation progress update:', progress);
      });
  }

  ngOnDestroy(): void {
    // Unsubscribe from all observables
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Check if the window is maximized
   */
  checkMaximized(): void {
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
  }

  /**
   * Toggle window maximize/restore
   */
  toggleMaximize(): void {
    this.ipcService.maximizeWindow()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          // After toggling, check the new state
          this.checkMaximized();
        },
        error: (error) => {
          this.errorMessage = `Error toggling window maximize: ${error.message}`;
          console.error('Error toggling window maximize:', error);
        }
      });
  }

  /**
   * Open file dialog
   */
  openFileDialog(): void {
    const options = {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] }
      ]
    };

    this.ipcService.showOpenDialog(options)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          if (!result.canceled && result.filePaths) {
            this.selectedFiles = result.filePaths;
            console.log('Selected files:', result.filePaths);
          }
        },
        error: (error) => {
          this.errorMessage = `Error opening file dialog: ${error.message}`;
          console.error('Error opening file dialog:', error);
        }
      });
  }

  /**
   * Get database path
   */
  getDatabasePath(): void {
    this.ipcService.getDatabasePath()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.databasePath = result.dbPath;
          console.log('Database path:', result);
        },
        error: (error) => {
          this.errorMessage = `Error getting database path: ${error.message}`;
          console.error('Error getting database path:', error);
        }
      });
  }

  /**
   * Trigger an error for demonstration purposes
   */
  triggerError(): void {
    // Call a method with an invalid folder path to trigger an error
    this.ipcService.checkFolderIndexable('')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          console.log('This should not be called:', result);
        },
        error: (error) => {
          this.errorMessage = `Triggered error: ${error.message}`;
          console.error('Triggered error:', error);
        }
      });
  }
}
