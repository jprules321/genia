import { Injectable } from '@angular/core';

// Update Window interface to include your electronAPI methods
declare global {
  interface Window {
    electronAPI: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      isWindowMaximized: () => Promise<boolean>;
      // Include your existing electronAPI methods
      showOpenDialog: (options: any) => Promise<any>;
    }
  }
}

@Injectable({
  providedIn: 'root'
})
export class ElectronWindowService {
  private isElectron: boolean;

  constructor() {
    this.isElectron = !!(window && window.electronAPI);
  }

  minimizeWindow(): void {
    if (this.isElectron) {
      window.electronAPI.minimizeWindow();
    }
  }

  maximizeWindow(): void {
    if (this.isElectron) {
      window.electronAPI.maximizeWindow();
    }
  }

  closeWindow(): void {
    if (this.isElectron) {
      window.electronAPI.closeWindow();
    }
  }

  async isMaximized(): Promise<boolean> {
    if (this.isElectron) {
      return await window.electronAPI.isWindowMaximized();
    }
    return false;
  }
}
