import { Injectable } from '@angular/core';
import { createSpinner, showSpinner, hideSpinner } from '@syncfusion/ej2-popups';

@Injectable({
  providedIn: 'root'
})
export class SpinnerService {

  private spinnerContainerId = 'global-spinner-container';

  constructor() {
    this.initializeSpinner();
  }

  private initializeSpinner() {
    let spinnerContainer = document.getElementById(this.spinnerContainerId);

    if (!spinnerContainer) {
      // Create a small spinner container (non-blocking)
      spinnerContainer = document.createElement('div');
      spinnerContainer.id = this.spinnerContainerId;
      spinnerContainer.style.position = 'fixed';
      spinnerContainer.style.top = '50%'; // Centered spinner
      spinnerContainer.style.left = '50%';
      spinnerContainer.style.transform = 'translate(-50%, -50%)';
      spinnerContainer.style.zIndex = '9999';
      spinnerContainer.style.pointerEvents = 'none'; // Allows clicking through it
      spinnerContainer.style.display = 'none'; // Initially hidden
      document.body.appendChild(spinnerContainer);

      // Initialize Syncfusion spinner
      createSpinner({
        target: spinnerContainer,
        cssClass: 'e-spin-overlay',
      });
    }
  }

  show() {
    const spinnerContainer = document.getElementById(this.spinnerContainerId);
    if (spinnerContainer) {
      spinnerContainer.style.display = 'block'; // Show the spinner
      showSpinner(spinnerContainer);
    }
  }

  hide() {
    const spinnerContainer = document.getElementById(this.spinnerContainerId);
    if (spinnerContainer) {
      hideSpinner(spinnerContainer);
      spinnerContainer.style.display = 'none'; // Hide the spinner
    }
  }
}
