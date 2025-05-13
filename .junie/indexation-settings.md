# Indexation Settings Implementation Plan

## Overview

This document outlines the plan for implementing indexation settings in the Genia application. The goal is to add user-configurable settings for the indexation process, allowing users to optimize the indexation performance based on their hardware capabilities.

## Current State

The application already has an `IndexingSettingsService` that manages indexation settings with default values. However, these settings are not currently exposed in the UI through the settings component. The `SettingsComponent` currently only displays the database path.

## Indexation Settings to Implement

Based on the analysis of the codebase, the following settings should be implemented:

### 1. File Processing Settings

| Setting | Description | Default Value | UI Control |
|---------|-------------|---------------|------------|
| Maximum File Size | Maximum file size in bytes that will be indexed | 10MB (10 * 1024 * 1024) | Numeric input with dropdown for units (KB, MB) |
| Index Hidden Files | Whether to index hidden files and folders | false | Toggle switch |
| Excluded Extensions | File extensions to exclude from indexing | exe, dll, so, dylib, zip, rar, tar, gz, tgz, 7z, jpg, jpeg, png, gif, bmp, ico, svg, mp3, wav, ogg, flac, m4a, mp4, avi, mkv, mov, wmv, db, sqlite, sqlite3 | Multi-select dropdown or tag input |
| Excluded Patterns | File patterns to exclude from indexing | node_modules, .git, .svn, .hg, .DS_Store, Thumbs.db, __pycache__, .vscode, .idea, dist, build, bin, obj | Multi-select dropdown or tag input |

### 2. Performance Settings

| Setting | Description | Default Value | UI Control |
|---------|-------------|---------------|------------|
| Small Folder Batch Size | Batch size for processing files in small folders (< 100 files) | 20 | Numeric input with slider |
| Medium Folder Batch Size | Batch size for processing files in medium folders (100-1000 files) | 50 | Numeric input with slider |
| Large Folder Batch Size | Batch size for processing files in large folders (> 1000 files) | 100 | Numeric input with slider |
| Worker Count | Number of parallel workers for indexation | CPU cores - 1 (or 4 if not available) | Numeric input with slider (max based on CPU cores) |
| Memory Threshold | Maximum memory usage percentage before throttling indexation | 80% | Numeric input with slider (0-100%) |

### 3. Error Handling Settings

| Setting | Description | Default Value | UI Control |
|---------|-------------|---------------|------------|
| Maximum Retries | Maximum number of retries for failed operations | 3 | Numeric input |
| Retry Delay | Delay between retries in milliseconds | 1000 | Numeric input |

## UI Design

The indexation settings should be added to the settings component as new sections:

```html
<!-- Indexation Settings Section -->
<div class="settings-section">
  <h3>Indexation Settings</h3>
  
  <!-- File Processing Settings Card -->
  <div class="settings-card">
    <h4>File Processing</h4>
    <!-- File processing settings controls -->
  </div>
  
  <!-- Performance Settings Card -->
  <div class="settings-card">
    <h4>Performance</h4>
    <!-- Performance settings controls -->
  </div>
  
  <!-- Error Handling Settings Card -->
  <div class="settings-card">
    <h4>Error Handling</h4>
    <!-- Error handling settings controls -->
  </div>
  
  <!-- Actions -->
  <div class="settings-actions">
    <button ejs-button cssClass="e-primary" (click)="saveIndexationSettings()">Save Settings</button>
    <button ejs-button (click)="resetIndexationSettings()">Reset to Defaults</button>
  </div>
</div>
```

Each settings card should contain the appropriate UI controls for the settings in that category. The UI should use Syncfusion components for consistency with the rest of the application.

## Implementation Steps

### 1. Update IndexingSettingsService

1. Add new properties to the `IndexingSettings` interface:
   - `workerCount`: Number of parallel workers
   - `memoryThresholdPercent`: Memory threshold percentage

2. Update the `DEFAULT_INDEXING_SETTINGS` constant with default values for the new properties.

3. Add methods to get and set the new properties.

### 2. Update WorkerPoolService

1. Modify the `initializeWorkerPool` method to use the worker count from the settings service.
2. Modify the `setMemoryThreshold` method to use the memory threshold from the settings service.
3. Add methods to dynamically adjust the worker pool size based on settings changes.

### 3. Update SettingsComponent

1. Inject the `IndexingSettingsService` into the component.
2. Add properties to store the indexation settings.
3. Add methods to load, save, and reset indexation settings.
4. Implement form validation for the settings.

### 4. Update SettingsComponent Template

1. Add new sections for indexation settings as outlined in the UI design.
2. Add appropriate Syncfusion UI controls for each setting.
3. Implement data binding between the UI controls and the component properties.
4. Add validation messages for invalid inputs.

### 5. Update ElectronWindowService

1. Add methods to communicate with the Electron main process for getting and setting indexation settings.
2. Implement error handling for these methods.

### 6. Update Electron Main Process

1. Add handlers for the new IPC messages related to indexation settings.
2. Implement storage and retrieval of indexation settings.

### 7. Add Unit Tests

1. Add unit tests for the updated `IndexingSettingsService`.
2. Add unit tests for the updated `WorkerPoolService`.
3. Add unit tests for the updated `SettingsComponent`.

### 8. Add Integration Tests

1. Add integration tests for the indexation settings UI.
2. Add integration tests for the interaction between the settings UI and the services.

### 9. Update Documentation

1. Update the indexing system documentation with information about the new configurable settings.
2. Add user documentation for the indexation settings.

## Testing Strategy

### Unit Testing

1. Test that the `IndexingSettingsService` correctly loads, saves, and resets settings.
2. Test that the `WorkerPoolService` correctly uses the settings from the `IndexingSettingsService`.
3. Test that the `SettingsComponent` correctly displays and updates settings.

### Integration Testing

1. Test that changes to the indexation settings in the UI are correctly saved and applied.
2. Test that the indexation process uses the configured settings.
3. Test that the settings are persisted between application restarts.

### Performance Testing

1. Test the indexation performance with different settings configurations.
2. Measure the impact of different worker counts and batch sizes on indexation speed.
3. Measure the impact of different memory thresholds on system stability.

## Conclusion

Implementing user-configurable indexation settings will allow users to optimize the indexation process based on their hardware capabilities. This will improve the user experience by providing more control over the application's performance and resource usage.

The implementation should follow the Angular and Syncfusion guidelines, and should be thoroughly tested to ensure reliability and performance.
