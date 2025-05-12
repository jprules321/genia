import { ApplicationConfig, provideZoneChangeDetection, ErrorHandler } from '@angular/core';
import {provideRouter, withComponentInputBinding} from '@angular/router';

import { routes } from './app.routes';
import {authInterceptor} from '../providers/interceptors/auth.interceptor';
import {provideHttpClient, withInterceptors} from '@angular/common/http';
import { ErrorHandlerService } from '../providers/error-handler.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: ErrorHandler, useClass: ErrorHandlerService }
  ]
};
