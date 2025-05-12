# Genia Development Guidelines

This document provides detailed information for developers and AI agents working on the Genia project. It includes build instructions, configuration details, code style guidelines, and documentation of key components.

## Build/Configuration Instructions

### Prerequisites
- Node.js (latest LTS version recommended)
- npm (comes with Node.js)
- Angular CLI (v19.2.4)
- For building platform-specific packages:
  - Windows: Windows 10/11 with Visual Studio Build Tools
  - macOS: macOS with Xcode Command Line Tools
  - Linux: Appropriate development packages for your distribution

### Environment Configuration
The application requires proper configuration of Parse backend services. Create or modify the environment files in `src/environments/`:

```typescript
// environment.ts (development)
export const environment = {
  production: false,
  parseAppId: 'YOUR_PARSE_APP_ID',
  parseJsKey: 'YOUR_PARSE_JS_KEY',
  parseServerUrl: 'YOUR_PARSE_SERVER_URL/parse'
};

// environment.prod.ts (production)
export const environment = {
  production: true,
  parseAppId: 'YOUR_PARSE_APP_ID',
  parseJsKey: 'YOUR_PARSE_JS_KEY',
  parseServerUrl: 'YOUR_PARSE_SERVER_URL/parse'
};
```

### Development Workflow
1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Angular Development Server**:
   ```bash
   npm start
   ```
   This starts the Angular app at http://localhost:4200/

3. **Run Electron Development Mode**:
   ```bash
   npm run electron:dev
   ```
   This starts the Angular server on port 4201 and launches Electron with live reloading.

4. **Building for Production**:
   - For all platforms: `npm run electron:build`
   - For Windows: `npm run electron:build:win`
   - For macOS: `npm run electron:build:mac`
   - For Linux: `npm run electron:build:linux`

   Built packages will be available in the `release/` directory.

### Electron Configuration
The Electron configuration is defined in `main.js` and includes:
- Single instance lock to prevent multiple instances
- Window creation and management
- System tray integration
- IPC (Inter-Process Communication) handlers

## Application Architecture

### Application Overview
Genia is a desktop application built with Electron and Angular that provides generative AI embedding and indexing of local data for LLMs to use as context database. The application allows users to:

- Index files from selected folders
- Search through indexed content
- Manage folders and files
- Configure application settings

### Technology Stack
#### Frontend
- **Angular**: Core framework for building the UI (v19.2.0)
- **Syncfusion Components**: UI component library for rich user interfaces
- **RxJS**: Library for reactive programming

#### Backend
- **Electron**: Framework for building cross-platform desktop applications (v36.1.0)
- **Node.js**: JavaScript runtime for the Electron main process
- **SQLite**: Embedded database for storing indexed file content
- **Parse SDK**: Backend-as-a-service for data storage and retrieval

### Architecture Layers
The application follows a layered architecture pattern:

1. **Presentation Layer**: Angular components that make up the UI
2. **Service Layer**: Angular services that handle business logic and data access
3. **Data Access Layer**: Services that interact with the database and external APIs
4. **Electron Layer**: Main process code that handles OS integration and file system operations

### Key Components
#### Angular Components
- **AppComponent**: Root component that sets up the application layout
- **SidebarComponent**: Navigation sidebar for the application
- **HeaderComponent**: Application header with window controls
- **FoldersComponent**: Manages folder selection and display
- **SearchComponent**: Provides search functionality for indexed content
- **SettingsComponent**: Allows configuration of application settings
- **EstimationsComponent**: Handles estimation data and calculations

#### Angular Services
- **ElectronWindowService**: Handles communication with the Electron main process
- **ParseService**: Initializes and provides access to Parse backend services
- **IndexingService**: Manages the indexing of files in folders
- **FileIndexingService**: Handles the actual indexing of individual files
- **IndexDatabaseService**: Manages database operations for indexed files
- **IncrementalIndexingService**: Handles incremental indexing of changed files
- **FoldersService**: Manages folder data and operations
- **EstimationService**: Handles estimation data and calculations

#### Electron Components
- **Main Process (main.js)**: Entry point for the Electron application
- **Preload Script (preload.js)**: Securely exposes main process functionality to the renderer process
- **IPC Bridge**: Handles communication between Angular and Electron

### Data Flow
#### Indexing Flow
1. User selects folders to index via the FoldersComponent
2. FoldersService stores folder information
3. IndexingService initiates the indexing process
4. FileIndexingService processes individual files
5. IndexDatabaseService stores indexed content in the SQLite database
6. Progress updates are sent back to the UI via ElectronWindowService

#### Search Flow
1. User enters search query in the SearchComponent
2. Search request is sent to the Electron main process
3. Main process queries the SQLite database
4. Results are returned to the Angular application
5. SearchComponent displays the results

### Design Patterns
- **Dependency Injection**: Angular's dependency injection system is used throughout the application
- **Observer Pattern**: RxJS Observables are used extensively for handling asynchronous operations
- **Repository Pattern**: Services like IndexDatabaseService and FoldersService act as repositories
- **Facade Pattern**: Services like IndexingService provide a simplified interface to a complex subsystem

## Development Information

### Project Structure
- `src/`: Angular application source code
  - `app/`: Angular components
  - `providers/`: Services for data access and business logic
  - `environments/`: Environment configuration files
  - `assets/`: Static assets like images and icons
- `main.js`: Electron main process file
- `preload.js`: Electron preload script for secure IPC
- `public/`: Public assets for the Electron application

### Code Style Guidelines
- Follow Angular style guide for component and service organization
- Use TypeScript interfaces for data models
- Maintain separation of concerns:
  - Components handle UI and user interaction
  - Services handle data access and business logic
  - Electron services handle desktop integration
- We always use SyncFusion components when possible.
- Follow SyncFusion guidelines for styling
- Refer to SyncFusion documentation PDF located here C:\Users\capit\Desktop\Genia\Genia\ej2-docs.pdf
- NEVER leave any function as a placeholder, always code what is necessary.

### Code Review Process
#### Before Submitting Code for Review
1. **Self-Review**: Review your own code before submitting it for review.
   - Check for logical errors, edge cases, and potential bugs
   - Ensure code meets the standards outlined in this document
   - Verify that all tests pass

2. **Documentation**: Ensure your code is properly documented.
   - Add JSDoc comments for all public methods and classes
   - Update README or other documentation if necessary

3. **Testing**: Write appropriate tests for your code.
   - Unit tests for individual components and services
   - Integration tests for component interactions
   - End-to-end tests for critical user flows

#### During Code Review
1. **Be Respectful**: Provide constructive feedback and be open to suggestions.
2. **Be Specific**: Point to specific lines of code and provide clear explanations.
3. **Be Timely**: Review code promptly to avoid blocking other team members.

### Code Quality Standards
#### General Guidelines
1. **Follow Angular Style Guide**: Adhere to the [Angular Style Guide](https://angular.io/guide/styleguide) for component and service organization.
2. **Use TypeScript Features**: Leverage TypeScript's type system to catch errors at compile time.
3. **Keep Functions Small**: Functions should do one thing and do it well.
4. **Avoid Code Duplication**: Extract common functionality into shared services or utilities.
5. **Use Meaningful Names**: Variables, functions, and classes should have descriptive names.

#### Angular-Specific Guidelines
1. **Component Structure**:
   - Keep components focused on a single responsibility
   - Use smart/container and dumb/presentational component pattern
   - Limit component size (< 400 lines as a general rule)

2. **Service Usage**:
   - Use services for data access and business logic
   - Inject services rather than instantiating them directly
   - Keep services focused on a specific domain

3. **Template Guidelines**:
   - Keep templates simple and readable
   - Use structural directives appropriately
   - Avoid complex logic in templates

4. **Reactive Programming**:
   - Use RxJS operators effectively
   - Properly manage subscriptions to avoid memory leaks
   - Use async pipe in templates when possible

#### Syncfusion Component Guidelines
1. **Prefer Syncfusion Components**: Use Syncfusion components when available instead of creating custom implementations.
2. **Follow Syncfusion Documentation**: Refer to the Syncfusion documentation for best practices.
3. **Consistent Styling**: Apply consistent styling to Syncfusion components throughout the application.

### Code Documentation Standards
1. **JSDoc Comments**: Use JSDoc comments for all public methods and classes.
   ```typescript
   /**
    * Description of what the function does
    * 
    * @param paramName Description of the parameter
    * @returns Description of the return value
    */
   ```

2. **Inline Comments**: Use inline comments for complex logic that isn't immediately obvious.

3. **TODO Comments**: Use TODO comments for code that needs future attention, but include a description of what needs to be done.
   ```typescript
   // TODO: Implement error handling for network failures
   ```

### Testing Standards
1. **Test Coverage**: Aim for high test coverage, especially for critical components and services.
2. **Test Organization**: Organize tests to mirror the structure of the code being tested.
3. **Test Naming**: Use descriptive test names that explain what is being tested.
   ```typescript
   it('should display error message when API returns an error', () => {
     // Test implementation
   });
   ```

### Performance Considerations
1. **Change Detection**: Use OnPush change detection strategy for performance-critical components.
2. **Lazy Loading**: Implement lazy loading for feature modules.
3. **Memory Management**: Properly manage subscriptions and event listeners.
4. **Bundle Size**: Be mindful of adding large dependencies that increase bundle size.

### Security Guidelines
1. **Input Validation**: Validate all user inputs, both in the UI and in services.
2. **XSS Prevention**: Use Angular's built-in sanitization for user-generated content.
3. **Secure Communication**: Ensure all API calls use HTTPS.
4. **Sensitive Data**: Never store sensitive data in local storage or session storage.

### Syncfusion Components
The project uses Syncfusion UI components for Angular. Key components include:
- SidebarComponent: For the application's main navigation sidebar
- TreeViewComponent: For hierarchical navigation within the sidebar
- ToolbarComponent: For the application's toolbar and window controls

## Indexing System

### Overview
The Genia Indexing System is responsible for indexing files in user-selected folders, storing their content in a SQLite database, and providing search functionality. The system has been refactored to improve performance, reliability, and maintainability.

### Architecture
The indexing system has been split into several specialized services to improve separation of concerns:

1. **IndexingService**: Coordinates the indexing process and manages the overall state.
2. **FileIndexingService**: Handles the actual indexing of files.
3. **IndexDatabaseService**: Manages database operations related to indexing.
4. **FileSystemService**: Handles file system operations.
5. **ContentTypeService**: Detects and manages content types for files.
6. **WorkerPoolService**: Manages a pool of workers for parallel processing.
7. **IncrementalIndexingService**: Handles incremental indexing of changed files.

### Key Features
- **Error Handling and Reliability**: Comprehensive error handling, error categorization, retry logic, transaction support
- **Performance Optimization**: Chunked processing, optimized database operations, worker pool, incremental indexing
- **User Experience**: Improved progress tracking, cancellation support, better error messages

### Usage Examples
#### Basic Indexing
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

#### Cancellable Indexing
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

### Refactored IndexingService
The IndexingService has been refactored into smaller, more focused components:

1. **IndexingStatusService**: Manages indexing status, progress, and cancellation
2. **FolderStatisticsService**: Manages folder statistics and progress
3. **IndexingErrorService**: Handles error categorization and logging
4. **FolderWatchingService**: Manages folder watching for changes
5. **IndexingIPCService**: Handles IPC communication related to indexing

The updated IndexingService delegates responsibilities to these specialized services while maintaining the same public API for backward compatibility.

## IPC Communication

### Enhanced IPC System
The application uses an enhanced IPC (Inter-Process Communication) system for communication between the Angular renderer process and the Electron main process. Key features include:

1. **Middleware System**: Allows processing messages through a chain of middleware functions
2. **Compression**: Automatically compresses large payloads to improve performance
3. **Security**: Adds message integrity verification using HMAC and timestamps for replay protection
4. **Service Registry**: Allows for dynamic registration and discovery of services

### Standardized IPC Message Format
Two primary interfaces standardize IPC communication:

- `IPCMessage<T>`: A generic interface for messages sent from the renderer to the main process
- `IPCResponse<T>`: A generic interface for responses sent from the main process to the renderer

### Using the Enhanced IPC Service
```typescript
import { IPCService } from '../../providers/ipc.service';

constructor(private ipcService: IPCService) {}

checkWindowMaximized(): void {
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
```

### Built-in Services
The following services are registered by default:

1. **systemInfo**: Provides system information (app version, platform, memory usage, etc.)
2. **fileSystem**: Provides file system operations (read/write files, list directories)
3. **database**: Provides database operations (statistics, queries)

### Electron Integration
Angular communicates with Electron through the `ElectronWindowService`, which uses the IPC bridge defined in `preload.js`. This ensures secure communication between the renderer process (Angular) and the main process (Electron).

## Documentation of Functions and Libraries

### Core Libraries
1. **Angular (v19.2.0)**
   - Core framework for building the UI
   - Uses Angular's component architecture, services, and dependency injection

2. **Electron (v36.1.0)**
   - Framework for building cross-platform desktop applications
   - Provides native OS integration, window management, and system tray functionality

3. **Parse SDK**
   - Backend-as-a-service for data storage and retrieval
   - Initialized in `ParseService` with configuration from environment files

4. **Syncfusion Components**
   - UI component library for Angular
   - Provides rich UI components like grids, charts, and navigation elements

### Key Services

#### ParseService
Located in `src/providers/parse.service.ts`
- Initializes the Parse SDK with configuration from environment files
- Provides access to Parse backend services

```typescript
// Usage example
import { ParseService } from '../providers/parse.service';
import Parse from 'parse';

// The service is automatically initialized when injected
constructor(private parseService: ParseService) {
  // Parse is now ready to use
  const query = new Parse.Query('YourClassName');
  query.find().then(results => {
    console.log(results);
  });
}
```

#### ElectronWindowService
Located in `src/providers/electron-window.service.ts`
- Provides methods for controlling the Electron window
- Handles window minimizing, maximizing, and closing

```typescript
// Usage example
import { ElectronWindowService } from '../providers/electron-window.service';

constructor(private electronWindowService: ElectronWindowService) {}

minimizeWindow(): void {
  this.electronWindowService.minimizeWindow();
}

maximizeWindow(): void {
  this.electronWindowService.maximizeWindow();
}

closeWindow(): void {
  this.electronWindowService.closeWindow();
}
```

#### EstimationService
Located in `src/providers/estimation.service.ts`
- Provides methods for retrieving estimation data from external APIs
- Handles calculation of quotes

```typescript
// Usage example
import { EstimationService } from '../providers/estimation.service';
import { ResponseData } from '../components/estimations/estimations.component';

constructor(private estimationService: EstimationService) {}

getEstimations(formId: number): void {
  this.estimationService.getEntries(formId).subscribe(
    data => {
      console.log('Estimations:', data);
    },
    error => {
      console.error('Error fetching estimations:', error);
    }
  );
}

calculateQuote(data: ResponseData): void {
  this.estimationService.calculateQuote(data).subscribe(
    response => {
      console.log('Quote calculation:', response);
    },
    error => {
      console.error('Error calculating quote:', error);
    }
  );
}
```

### Electron IPC Communication
The application uses Electron's contextBridge API to securely expose main process functionality to the renderer process.

#### Preload Script (preload.js)
Exposes a limited set of functions through the `electronAPI` object:
- `minimizeWindow()`: Minimizes the application window
- `maximizeWindow()`: Toggles window maximization
- `closeWindow()`: Closes the application window
- `isWindowMaximized()`: Checks if the window is maximized
- `showOpenDialog(options)`: Shows the system file open dialog

#### Main Process (main.js)
Handles IPC messages from the renderer process:
- `minimize-window`: Minimizes the window
- `maximize-window`: Toggles window maximization
- `close-window`: Closes the window or hides it to the system tray
- `is-window-maximized`: Returns the window's maximized state
- `show-open-dialog`: Shows the system file open dialog

### Auto-Launch Functionality (Commented Out)
The main.js file includes commented-out code for auto-launching the application on system startup. To enable this functionality:

1. Install the auto-launch package:
   ```bash
   npm install auto-launch --save
   ```

2. Uncomment the auto-launch code in main.js

3. Add IPC handlers in your Angular service to control auto-launch settings from the UI.

## Troubleshooting

### Common Issues

1. **Parse Initialization Errors**
   - Ensure environment files have correct Parse configuration
   - Check that Parse Server is running and accessible

2. **Electron Build Issues**
   - Ensure you have the required build tools for your platform
   - For Windows: `npm install --global windows-build-tools`
   - For macOS: Install Xcode Command Line Tools

3. **Tray Icon Not Showing**
   - Check that the icon path in main.js is correct
   - Ensure the icon file exists in the specified location

4. **Angular-Electron Communication Issues**
   - Verify that the preload.js script is correctly exposing the required functions
   - Check that the ElectronWindowService is correctly using the exposed API

5. **Indexing Issues**
   - Check file permissions for folders being indexed
   - Verify that the database path is correctly configured
   - Check for errors in the indexing process logs
