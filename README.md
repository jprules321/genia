Genia is a desktop application that provides Generative AI Embedding and Indexing of local data for LLMs (Large Language Models) to use as a context database. Built with Angular and Electron, Genia helps you organize and utilize your local data with AI capabilities.
## Features
- Desktop application for Windows, macOS, and Linux
- Generative AI embedding and indexing
- Integration with local data sources
- User-friendly interface built with Angular and Syncfusion components

## Prerequisites
- [Node.js](https://nodejs.org/) (latest LTS version recommended)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Angular CLI](https://angular.io/cli) (v19.2.4)

## Installation
1. Clone the repository:
``` bash
   git clone https://github.com/yourusername/genia.git
   cd genia
```
1. Install dependencies:
``` bash
   npm install
```
## Development
### Run Angular Development Server
To start the Angular development server:
``` bash
npm start
```
Navigate to `http://localhost:4200/` in your browser. The application will automatically reload if you change any source files.
### Run Electron Development Mode
To run the application in Electron development mode:
``` bash
npm run electron:dev
```
This command will:
1. Start the Angular development server on port 4201
2. Wait for the server to be ready
3. Launch Electron with the Angular app as the UI

This setup allows for live reloading of both Angular and Electron components during development.
## Building
### Build for Production
To build the application for production:
``` bash
npm run build
```
This will create production-ready files in the `dist/` directory.
### Build Electron Application
To build the Electron application for all platforms:
``` bash
npm run electron:build
```
### Platform-Specific Builds
Build for Windows:
``` bash
npm run electron:build:win
```
Build for macOS:
``` bash
npm run electron:build:mac
```
Build for Linux:
``` bash
npm run electron:build:linux
```
The packaged applications a be available in the `release/` directory.
## Project Structure
- `src/`: Angular application source code
- `main.js`: Electron main process file
- `preload.js`: Electron preload script
- `public/`: Public assets for the application

## Contributing
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License
[Include your license information here]
## Acknowledgements
- [Angular](https://angular.io/)
- [Electron](https://www.electronjs.org/)
- [Syncfusion Components](https://www.syncfusion.com/angular-components)
#   g e n i a  
 #   g e n i a  
 