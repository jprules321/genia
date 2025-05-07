import {inject, Injectable} from '@angular/core';
import {
  HttpRequest, HttpHandlerFn
} from '@angular/common/http';
import { AuthService } from '../auth.service';

export function authInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn) {
  // Inject the current `AuthService` and use it to get an authentication token:
  const authToken = inject(AuthService).authToken;
  // Clone the request to add the authentication header.
  const newReq = req.clone({
    headers: req.headers.append('Authorization', authToken),
  });
  return next(newReq);
}
