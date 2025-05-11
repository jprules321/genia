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

### Syncfusion Components
The project uses Syncfusion UI components for Angular. Key components include:
- SidebarComponent: For the application's main navigation sidebar
- TreeViewComponent: For hierarchical navigation within the sidebar
- ToolbarComponent: For the application's toolbar and window controls

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
