import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronWindowService } from '../../providers/electron-window.service';
import { ButtonAllModule } from '@syncfusion/ej2-angular-buttons';
import { TextBoxAllModule } from '@syncfusion/ej2-angular-inputs';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonAllModule, TextBoxAllModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  // Database settings
  public databasePath: string = '';
  public databaseDir: string = '';
  public isLoading: boolean = false;
  public errorMessage: string = '';

  constructor(private electronWindowService: ElectronWindowService) {}

  ngOnInit(): void {
    this.loadDatabasePath();
  }

  /**
   * Load the database path from the Electron main process
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
   * Open the database directory in the file explorer
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
