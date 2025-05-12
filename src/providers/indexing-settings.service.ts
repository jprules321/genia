import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ElectronWindowService } from './electron-window.service';

/**
 * Interface defining the indexing settings
 */
export interface IndexingSettings {
  /** Maximum file size in bytes that will be indexed (default: 10MB) */
  maxFileSizeBytes: number;

  /** File extensions to exclude from indexing */
  excludedExtensions: string[];

  /** File patterns to exclude from indexing (e.g., node_modules, .git) */
  excludedPatterns: string[];

  /** Whether to index hidden files and folders */
  indexHiddenFiles: boolean;

  /** Batch size for processing files in small folders (< 100 files) */
  smallFolderBatchSize: number;

  /** Batch size for processing files in medium folders (100-1000 files) */
  mediumFolderBatchSize: number;

  /** Batch size for processing files in large folders (> 1000 files) */
  largeFolderBatchSize: number;

  /** Maximum number of retries for failed operations */
  maxRetries: number;

  /** Delay between retries in milliseconds */
  retryDelayMs: number;
}

/**
 * Default indexing settings
 */
export const DEFAULT_INDEXING_SETTINGS: IndexingSettings = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  excludedExtensions: [
    'exe', 'dll', 'so', 'dylib', // Binaries
    'zip', 'rar', 'tar', 'gz', 'tgz', '7z', // Archives
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'svg', // Images
    'mp3', 'wav', 'ogg', 'flac', 'm4a', // Audio
    'mp4', 'avi', 'mkv', 'mov', 'wmv', // Video
    'db', 'sqlite', 'sqlite3', // Databases
  ],
  excludedPatterns: [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '.DS_Store',
    'Thumbs.db',
    '__pycache__',
    '.vscode',
    '.idea',
    'dist',
    'build',
    'bin',
    'obj',
  ],
  indexHiddenFiles: false,
  smallFolderBatchSize: 20,
  mediumFolderBatchSize: 50,
  largeFolderBatchSize: 100,
  maxRetries: 3,
  retryDelayMs: 1000,
};

/**
 * Service for managing indexing settings
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingSettingsService {
  private settings: IndexingSettings = { ...DEFAULT_INDEXING_SETTINGS };
  private settingsSubject = new BehaviorSubject<IndexingSettings>(this.settings);

  constructor(private electronWindowService: ElectronWindowService) {
    this.loadSettings();
  }

  /**
   * Get the current indexing settings
   */
  getSettings(): IndexingSettings {
    return { ...this.settings };
  }

  /**
   * Get an observable of the indexing settings
   */
  getSettings$(): Observable<IndexingSettings> {
    return this.settingsSubject.asObservable();
  }

  /**
   * Update the indexing settings
   * @param settings New settings to apply (partial or complete)
   */
  updateSettings(settings: Partial<IndexingSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.settingsSubject.next(this.settings);
    this.saveSettings();
  }

  /**
   * Reset settings to default values
   */
  resetToDefaults(): void {
    this.settings = { ...DEFAULT_INDEXING_SETTINGS };
    this.settingsSubject.next(this.settings);
    this.saveSettings();
  }

  /**
   * Get the appropriate batch size based on folder size
   * @param fileCount Number of files in the folder
   */
  getBatchSizeForFolder(fileCount: number): number {
    if (fileCount < 100) {
      return this.settings.smallFolderBatchSize;
    } else if (fileCount < 1000) {
      return this.settings.mediumFolderBatchSize;
    } else {
      return this.settings.largeFolderBatchSize;
    }
  }

  /**
   * Check if a file should be excluded based on its extension
   * @param filePath Path to the file
   */
  shouldExcludeByExtension(filePath: string): boolean {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    return this.settings.excludedExtensions.includes(extension);
  }

  /**
   * Check if a file or folder should be excluded based on patterns
   * @param path Path to check
   */
  shouldExcludeByPattern(path: string): boolean {
    return this.settings.excludedPatterns.some(pattern =>
      path.includes(`/${pattern}/`) || path.includes(`\\${pattern}\\`) ||
      path.endsWith(`/${pattern}`) || path.endsWith(`\\${pattern}`)
    );
  }

  /**
   * Check if a file should be excluded based on its size
   * @param sizeBytes File size in bytes
   */
  shouldExcludeBySize(sizeBytes: number): boolean {
    return sizeBytes > this.settings.maxFileSizeBytes;
  }

  /**
   * Check if a file should be excluded based on whether it's hidden
   * @param isHidden Whether the file is hidden
   */
  shouldExcludeHidden(isHidden: boolean): boolean {
    return isHidden && !this.settings.indexHiddenFiles;
  }

  /**
   * Load settings from storage
   */
  private async loadSettings(): Promise<void> {
    try {
      const result = await this.electronWindowService.getIndexingSettings();

      if (result.success && result.settings) {
        // Merge saved settings with defaults to ensure all properties exist
        this.settings = { ...DEFAULT_INDEXING_SETTINGS, ...result.settings };
        this.settingsSubject.next(this.settings);
      }
    } catch (error) {
      console.error('Error loading indexing settings:', error);
      // Fall back to defaults if loading fails
      this.settings = { ...DEFAULT_INDEXING_SETTINGS };
      this.settingsSubject.next(this.settings);
    }
  }

  /**
   * Save settings to storage
   */
  private async saveSettings(): Promise<void> {
    try {
      await this.electronWindowService.saveIndexingSettings(this.settings);
    } catch (error) {
      console.error('Error saving indexing settings:', error);
    }
  }
}
