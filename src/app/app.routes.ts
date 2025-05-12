import { Routes } from '@angular/router';
import {EstimationsComponent} from '../components/estimations/estimations.component';
import {EstimationDetailsComponent} from '../components/estimation-details/estimation-details.component';
import {LoginComponent} from '../components/login/login.component';
import {authGuard} from '../providers/guards/auth.guard';
import {ProjectGanttComponent} from '../components/project-gantt/project-gantt.component';
import {FoldersComponent} from '../components/folders/folders.component';
import {SettingsComponent} from '../components/settings/settings.component';

export const routes: Routes = [
  { path: 'estimations', component: EstimationsComponent, canActivate: [authGuard] },
  { path: 'estimations/:id', component: EstimationDetailsComponent, canActivate: [authGuard] },
  { path: 'projects', component: ProjectGanttComponent, canActivate: [authGuard] },
  { path: 'folders', component: FoldersComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsComponent, canActivate: [authGuard] },
  { path: 'login', component: LoginComponent },
  { path: '',   redirectTo: '/folders', pathMatch: 'full', },
  { path: '**', redirectTo: '/login' } // Catch-all route
];
