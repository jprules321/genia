import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronWindowService } from '../../providers/electron-window.service';
import { ButtonAllModule } from '@syncfusion/ej2-angular-buttons';
import { TextBoxAllModule } from '@syncfusion/ej2-angular-inputs';

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
  imports: [CommonModule, FormsModule, ButtonAllModule, TextBoxAllModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  /** Path to the database file */
  public databasePath: string = '';

  /** Directory containing the database file */
  public databaseDir: string = '';

  /** Flag indicating if data is being loaded */
  public isLoading: boolean = false;

  /** Error message to display to the user */
  public errorMessage: string = '';

  /**
   * Creates an instance of SettingsComponent
   * @param electronWindowService Service for interacting with the Electron window
   */
  constructor(private electronWindowService: ElectronWindowService) {}

  /**
   * Lifecycle hook that is called after data-bound properties are initialized
   * Loads the database path when the component is initialized
   */
  ngOnInit(): void {
    this.loadDatabasePath();
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
}
