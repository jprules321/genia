# Genia Application Architecture

This document provides a high-level overview of the Genia application architecture, including its major components, data flow, and design patterns.

## Application Overview

Genia is a desktop application built with Electron and Angular that provides generative AI embedding and indexing of local data for LLMs to use as context database. The application allows users to:

- Index files from selected folders
- Search through indexed content
- Manage folders and files
- Configure application settings

## Technology Stack

### Frontend
- **Angular**: Core framework for building the UI (v19.2.0)
- **Syncfusion Components**: UI component library for rich user interfaces
- **RxJS**: Library for reactive programming

### Backend
- **Electron**: Framework for building cross-platform desktop applications (v36.1.0)
- **Node.js**: JavaScript runtime for the Electron main process
- **SQLite**: Embedded database for storing indexed file content
- **Parse SDK**: Backend-as-a-service for data storage and retrieval

## Architecture Layers

The application follows a layered architecture pattern:

1. **Presentation Layer**: Angular components that make up the UI
2. **Service Layer**: Angular services that handle business logic and data access
3. **Data Access Layer**: Services that interact with the database and external APIs
4. **Electron Layer**: Main process code that handles OS integration and file system operations

## Key Components

### Angular Components

#### Core Components
- **AppComponent**: Root component that sets up the application layout
- **SidebarComponent**: Navigation sidebar for the application
- **HeaderComponent**: Application header with window controls

#### Feature Components
- **FoldersComponent**: Manages folder selection and display
- **SearchComponent**: Provides search functionality for indexed content
- **SettingsComponent**: Allows configuration of application settings
- **EstimationsComponent**: Handles estimation data and calculations

### Angular Services

#### Core Services
- **ElectronWindowService**: Handles communication with the Electron main process
- **ParseService**: Initializes and provides access to Parse backend services

#### Feature Services
- **IndexingService**: Manages the indexing of files in folders
- **FileIndexingService**: Handles the actual indexing of individual files
- **IndexDatabaseService**: Manages database operations for indexed files
- **IncrementalIndexingService**: Handles incremental indexing of changed files
- **FoldersService**: Manages folder data and operations
- **EstimationService**: Handles estimation data and calculations

### Electron Components

- **Main Process (main.js)**: Entry point for the Electron application
- **Preload Script (preload.js)**: Securely exposes main process functionality to the renderer process
- **IPC Bridge**: Handles communication between Angular and Electron

## Data Flow

### Indexing Flow
1. User selects folders to index via the FoldersComponent
2. FoldersService stores folder information
3. IndexingService initiates the indexing process
4. FileIndexingService processes individual files
5. IndexDatabaseService stores indexed content in the SQLite database
6. Progress updates are sent back to the UI via ElectronWindowService

### Search Flow
1. User enters search query in the SearchComponent
2. Search request is sent to the Electron main process
3. Main process queries the SQLite database
4. Results are returned to the Angular application
5. SearchComponent displays the results

## Design Patterns

### Dependency Injection
Angular's dependency injection system is used throughout the application to provide services to components and other services.

### Observer Pattern
RxJS Observables are used extensively for handling asynchronous operations and event-based programming.

### Repository Pattern
Services like IndexDatabaseService and FoldersService act as repositories, abstracting the data access logic.

### Facade Pattern
Services like IndexingService provide a simplified interface to a complex subsystem of multiple services.

## Communication Patterns

### Angular-Electron Communication
Communication between Angular and Electron is handled through a secure IPC bridge defined in preload.js:

1. **Renderer to Main**: Angular services call methods exposed by the electronAPI object
2. **Main to Renderer**: Main process sends messages to the renderer process using IPC channels

### Service-to-Service Communication
Services communicate with each other through:
1. **Direct Injection**: Services are injected into other services
2. **Observable Streams**: Services expose Observable streams that other services can subscribe to

## Error Handling Strategy

The application implements a comprehensive error handling strategy:

1. **Service Level**: Services catch and handle errors specific to their domain
2. **Component Level**: Components handle UI-specific errors and display appropriate messages
3. **Global Error Handler**: A global error handler catches uncaught exceptions
4. **Error Categorization**: Errors are categorized by type (network, file system, permission, etc.)
5. **Error Logging**: Errors are logged for debugging and analysis

## Future Architecture Considerations

### Scalability Improvements
- Implement worker threads for parallel processing of files
- Add sharding capabilities for the database to handle large datasets

### Reliability Enhancements
- Implement circuit breakers for external services
- Add self-healing mechanisms for common failure scenarios

### Performance Optimizations
- Implement caching for frequently accessed data
- Optimize database queries and indexing

## Conclusion

The Genia application follows a well-structured architecture that separates concerns and promotes maintainability. The combination of Angular and Electron provides a powerful platform for building a desktop application with rich UI capabilities and native OS integration.

By understanding this architecture, developers can more easily navigate the codebase, make changes, and add new features while maintaining the overall design integrity of the application.
