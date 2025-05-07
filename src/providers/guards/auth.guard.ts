import {CanActivateFn, Router} from '@angular/router';
import {inject} from '@angular/core';

export const authGuard: CanActivateFn = (route, state) => {
  return true;
  const router = inject(Router); // Inject Router
  const storedHash = localStorage.getItem('userHash');
  const verifiedHash = 'c871058500bf843688fbaf1d11de0d5a'; // The required hash

  if (storedHash === verifiedHash) {
    // User is authorized, allow access
    return true;
  } else {
    // User is not authorized, redirect to the login page
    router.navigate(['/login']);
    return false;
  }

};
