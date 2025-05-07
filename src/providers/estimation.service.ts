import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {ResponseData} from '../components/estimations/estimations.component';
import {ICalculateQuoteResponse, IQuoteResults} from '../components/estimation-details/estimation-details.component';

@Injectable({
  providedIn: 'root'
})
export class EstimationService {
  private wordpressUrl = 'https://grdf.ca/wp-json/estimation/v1';
  private apiUrl =  'https://server.grdf.ca';

  constructor(private http: HttpClient) {}

  // Get all entries for a given form ID
  getEntries(formId: number): Observable<any> {
    return this.http.get<any>(`${this.wordpressUrl}/entries/${formId}`);
  }

  // Get a specific entry by entry ID
  getEntry(entryId: number): Observable<any> {
    return this.http.get<any>(`${this.wordpressUrl}/entry/${entryId}`);
  }

  calculateQuote(data: ResponseData): Observable<ICalculateQuoteResponse> {
    return this.http.post<any>(`${this.apiUrl}/estimation`, data);
  }
}
