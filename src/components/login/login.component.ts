import { Component } from '@angular/core';
import {TextBoxAllModule} from '@syncfusion/ej2-angular-inputs';
import {FormsModule} from '@angular/forms';
import {ButtonAllModule} from '@syncfusion/ej2-angular-buttons';
import CryptoJS from 'crypto-js';
import {Router} from '@angular/router';


@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  imports: [
    TextBoxAllModule,
    FormsModule,
    ButtonAllModule
  ],
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {

  constructor(private router: Router) { }

  // Login credentials model
  credentials = {
    email: '',
    password: ''
  };

  onLogin(): void {
    if (this.credentials.email && this.credentials.password) {
      // Concatenate email and password (you can change this logic as needed)
      const dataToHash = `${this.credentials.email}:${this.credentials.password}`;

      // Generate MD5 hash
      const md5Hash = CryptoJS.MD5(dataToHash).toString();

      // Store the hash in localStorage
      localStorage.setItem('userHash', md5Hash);
      this.router.navigate(['/estimations']);
    } else {
      alert('Please fill in both email and password!');
    }

  }
}
