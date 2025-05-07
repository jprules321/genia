// src/app/services/parse.service.ts
import { Injectable } from '@angular/core';
import Parse from 'parse';
// Ensure environment has appId, jsKey, AND serverUrl
import { environment } from '../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ParseService {
  // No need for the flag if initialization is synchronous and in constructor
  // public parseInitialized = false;

  constructor() {
    // Initialize directly in the constructor for singleton services
    this.initializeParse();
  }

  private initializeParse(): void {
    // You could add a check here if you were worried about it running multiple times,
    // but with providedIn: 'root', the constructor typically runs only once.
    // if ((Parse as any).applicationId) { // Check if already initialized
    //    console.log('Parse already initialized.');
    //    return;
    // }

    try {
      console.log('Initializing Parse...');
      Parse.initialize(environment.parseAppId, environment.parseJsKey);

      // --- CRUCIAL: Add Server URL ---
      // Assuming environment.ts has: parseServerUrl: 'YOUR_SERVER_URL/parse'
      if (!environment.parseServerUrl) {
        console.error('Parse Server URL is missing in environment configuration!');
        throw new Error('Parse Server URL configuration is missing.');
      }
      // The Parse typings might expect Parse.serverURL directly
      Parse.serverURL = environment.parseServerUrl;
      // Or sometimes it's needed like this (less common now):
      // (Parse as any).serverURL = environment.parseServerUrl;

      // --- REMOVE THIS LINE ---
      // //@ts-ignore
      // global.Parse = Parse; // Unnecessary and potentially harmful

      console.log('Parse initialized successfully with App ID:', environment.parseAppId, 'and Server URL:', Parse.serverURL);

    } catch (e) {
      console.error('Error initializing Parse Service:', e);
      // Re-throw or handle more gracefully depending on app requirements
      throw e; // Make it clear initialization failed
    }
  }

  // Optional: Expose the Parse instance if needed, though direct import is standard
  // get Parse() {
  //   return Parse;
  // }
}
