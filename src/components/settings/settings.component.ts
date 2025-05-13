import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronWindowService } from '../../providers/electron-window.service';
import { IndexingSettingsService, IndexingSettings } from '../../providers/indexing-settings.service';
import { ButtonAllModule } from '@syncfusion/ej2-angular-buttons';
import { TextBoxAllModule } from '@syncfusion/ej2-angular-inputs';
import { SliderModule } from '@syncfusion/ej2-angular-inputs';
import { SwitchModule } from '@syncfusion/ej2-angular-buttons';
import { NumericTextBoxAllModule } from '@syncfusion/ej2-angular-inputs';
import { DropDownListAllModule } from '@syncfusion/ej2-angular-dropdowns';
import { MultiSelectAllModule } from '@syncfusion/ej2-angular-dropdowns';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

/**
 * SettingsComponent handles the application settings UI
 *
 * This component allows users to:
 * - View the current database location
 * - Open the database directory in the file explorer
 * - (Future) Configure other application settings
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonAllModule,
    TextBoxAllModule,
    SliderModule,
    SwitchModule,
    NumericTextBoxAllModule,
    DropDownListAllModule,
    MultiSelectAllModule
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {
  /** Path to the database file */
  public databasePath: string = '';

  /** Directory containing the database file */
  public databaseDir: string = '';

  /** Flag indicating if data is being loaded */
  public isLoading: boolean = false;

  /** Error message to display to the user */
  public errorMessage: string = '';

  /** Current indexation settings */
  public indexationSettings: IndexingSettings;

  /** Flag indicating if indexation settings are being saved */
  public isSavingSettings: boolean = false;

  /** Flag indicating if indexation settings have been modified */
  public settingsModified: boolean = false;

  /** Available file size units */
  public fileSizeUnits: { text: string, value: number }[] = [
    { text: 'KB', value: 1024 },
    { text: 'MB', value: 1024 * 1024 },
    { text: 'GB', value: 1024 * 1024 * 1024 }
  ];

  /** Selected file size unit */
  public selectedFileSizeUnit: { text: string, value: number } = this.fileSizeUnits[1]; // Default to MB

  /** Maximum file size in selected unit */
  public maxFileSizeInUnit: number;

  /** Maximum number of CPU cores available */
  public maxCpuCores: number = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 8;

  /** Subject for handling component destruction */
  private destroy$ = new Subject<void>();

  /**
   * Creates an instance of SettingsComponent
   * @param electronWindowService Service for interacting with the Electron window
   * @param indexingSettingsService Service for managing indexing settings
   */
  constructor(
    private electronWindowService: ElectronWindowService,
    private indexingSettingsService: IndexingSettingsService
  ) {
    // Initialize with default settings
    this.indexationSettings = this.indexingSettingsService.getSettings();
    this.maxFileSizeInUnit = this.indexationSettings.maxFileSizeBytes / this.selectedFileSizeUnit.value;
  }

  /**
   * Lifecycle hook that is called after data-bound properties are initialized
   * Loads the database path and indexation settings when the component is initialized
   */
  ngOnInit(): void {
    this.loadDatabasePath();
    this.loadIndexationSettings();

    // Subscribe to settings changes
    this.indexingSettingsService.getSettings$()
      .pipe(takeUntil(this.destroy$))
      .subscribe(settings => {
        this.indexationSettings = settings;
        this.maxFileSizeInUnit = this.indexationSettings.maxFileSizeBytes / this.selectedFileSizeUnit.value;
      });
  }

  /**
   * Lifecycle hook that is called when the component is destroyed
   * Cleans up subscriptions to prevent memory leaks
   */
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Loads the database path from the Electron main process
   *
   * This method:
   * 1. Sets the loading state
   * 2. Requests the database path from the Electron main process
   * 3. Updates the component properties with the result
   * 4. Handles any errors that occur during the process
   *
   * @returns A promise that resolves when the operation is complete
   */
  async loadDatabasePath(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const result = await this.electronWindowService.getDatabasePath();

      if (result.success) {
        this.databasePath = result.dbPath;
        this.databaseDir = result.dbDir;
      } else {
        this.errorMessage = result.error || 'Failed to get database path';
      }
    } catch (error: unknown) {
      this.errorMessage = error instanceof Error ? error.message : 'An error occurred while getting the database path';
      console.error('Error getting database path:', error);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Opens the database directory in the system's file explorer
   *
   * This method:
   * 1. Validates that the database directory path is available
   * 2. Requests the Electron main process to open the directory
   * 3. Handles any errors that occur during the process
   *
   * @returns A promise that resolves when the operation is complete
   */
  async openDatabaseDirectory(): Promise<void> {
    if (!this.databaseDir) {
      this.errorMessage = 'Database directory path is not available';
      return;
    }

    try {
      const result = await this.electronWindowService.openDirectory(this.databaseDir);

      if (!result.success) {
        this.errorMessage = result.error || 'Failed to open database directory';
      }
    } catch (error: unknown) {
      this.errorMessage = error instanceof Error ? error.message : 'An error occurred while opening the database directory';
      console.error('Error opening database directory:', error);
    }
  }

  /**
   * Loads indexation settings from the service
   */
  loadIndexationSettings(): void {
    this.indexationSettings = this.indexingSettingsService.getSettings();
    this.maxFileSizeInUnit = this.indexationSettings.maxFileSizeBytes / this.selectedFileSizeUnit.value;
    this.settingsModified = false;
  }

  /**
   * Saves the current indexation settings
   */
  saveIndexationSettings(): void {
    this.isSavingSettings = true;
    this.errorMessage = '';

    try {
      // Convert max file size from the selected unit to bytes
      const maxFileSizeBytes = this.maxFileSizeInUnit * this.selectedFileSizeUnit.value;

      // Update the settings
      this.indexingSettingsService.updateSettings({
        ...this.indexationSettings,
        maxFileSizeBytes
      });

      this.settingsModified = false;
    } catch (error: unknown) {
      this.errorMessage = error instanceof Error ? error.message : 'An error occurred while saving indexation settings';
      console.error('Error saving indexation settings:', error);
    } finally {
      this.isSavingSettings = false;
    }
  }

  /**
   * Resets indexation settings to default values
   */
  resetIndexationSettings(): void {
    this.indexingSettingsService.resetToDefaults();
    this.loadIndexationSettings();
  }

  /**
   * Handles changes to the file size unit
   * @param event The change event
   */
  onFileSizeUnitChange(event: any): void {
    const oldUnit = this.selectedFileSizeUnit.value;
    const newUnit = event.value;

    // Convert the max file size to the new unit
    this.maxFileSizeInUnit = (this.maxFileSizeInUnit * oldUnit) / newUnit;
    this.settingsModified = true;
  }

  /**
   * Marks settings as modified when any setting is changed
   */
  onSettingChange(): void {
    this.settingsModified = true;
  }
}
