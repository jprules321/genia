import {Component, OnInit, ViewChild} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {EstimationService} from '../../providers/estimation.service';
import {
  CommandClickEventArgs,
  CommandModel,
  FilterSettingsModel,
  GridAllModule, GridComponent,
  PageSettingsModel
} from '@syncfusion/ej2-angular-grids';
import {ActivatedRoute, Router} from '@angular/router';
import {SpinnerService} from '../../providers/spinner.service';
import {NgIf} from '@angular/common';

export interface FluentFormEntry {
  id: string;
  form_id: string;
  serial_number: string;
  response: ResponseData;
  source_url: string;
  user_id: string;
  status: string;
  is_favourite: string;
  browser: string;
  device: string;
  ip: string;
  city: string | null;
  country: string | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_type: string | null;
  currency: string | null;
  payment_total: string | null;
  total_paid: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResponseData {
  names: {
    first_name: string;
    last_name: string;
  };
  email: string;
  phone: string;
  address_1: {
    address_line_1: string;
    city: string;
    zip: string;
  };
  contact_pref: string;
  longeur_en_pieds: string;
  largeur_en_pieds: string;
  type_de_plancher: string;
  lattes_revetement: string | null;
  structure_du_plancher: string | null;
  muret_de_6_pouces: string;
  isolation_plancher: string;
  hauteur_mur: string;
  materiel_murs: string;
  isolation_mur: string;
  couleur_finition_exterieure: string;
  couleur_finition_exterieure_autre: string | null;
  ferme_de_toit: string;
  pente_de_toit: string;
  nombre_de_versant: string;
  type_revetement_toiture: string;
  couleur_toiture: string;
  dimension_porte_garage_1: string;
  nombre_porte_garage: string;
  dimension_porte_garage_2: string | null;
  dimension_porte_garage_3: string | null;
  dimension_porte_garage_4: string | null;
  porte_garage_avec_fenetre: string;
  porte_garage_motorise: string;
  couleur_porte_garage: string;
  porte_garage: string | null;
  couleur_portre_garage_autre: string | null;
  nombre_de_fenetres: string;
  dimensions_fenetres: string;
  type_de_fenetres: string;
  couleur_fenetres: string;
  couleur_fenetres_autre: string | null;
  nombre_de_porte_pietons: string;
  couleur_porte_pieton: string;
  couleur_porte_pieton_autre: string | null;
  extension_toit: string;
  autres_ajouts: any[];
  file_upload: string[];
  commentaires: string;
  full_name: string | null;
  epaisseur_isolation_plancher: string;
  installation_tyvek: string;
  revetement_exterieur: string;
  type_finition_exterieure: string;
  type_de_moteur: string;
  fenetres_garage: string;
  portes_pieton: string;
  type_fenetre_porte_pieton: string;
}
@Component({
  selector: 'app-estimations',
  imports: [
    GridAllModule,
    NgIf
  ],
  templateUrl: './estimations.component.html',
  styleUrl: './estimations.component.scss'
})
export class EstimationsComponent implements OnInit{
  @ViewChild('gridComponent', {static: true}) grid!: GridComponent;
  public pageSettings: PageSettingsModel;
  public filterSettings: FilterSettingsModel;
  public toolbar: string[];
  public orderidrules: Object;
  public commands: CommandModel[];

  constructor(private route: ActivatedRoute,private router: Router, private estimationService: EstimationService, private spinner: SpinnerService) { }

  async ngOnInit() {
    await this.loadEstimations();
    this.pageSettings = { pageCount: 5 };
    this.filterSettings = { type: 'Excel' };
    this.toolbar = ['Search'];
    this.commands = [{buttonOption: {iconCss: 'e-icons e-large e-search'}, title: 'Details' }];
  }

  estimationEntriesLoaded = false;
  entries: FluentFormEntry[] = [];

  public async loadEstimations() {
    this.estimationEntriesLoaded = false;
    this.spinner.show();
    const entriesResponse = await firstValueFrom(this.estimationService.getEntries(14));
    const entriesResponse2 = await firstValueFrom(this.estimationService.getEntries(15));
    if (entriesResponse.entries === undefined || !entriesResponse.entries.length) {
      alert('No entries found');
    }
    this.entries = entriesResponse.entries;
    this.entries.push(...entriesResponse2.entries);
    this.entries.forEach(e => {
      if (e.response) {
        e.response = JSON.parse(e.response?.toString())
        e.response['full_name'] = e.response.names.first_name + ' ' + e.response.names.last_name;
      }
    })
    this.estimationEntriesLoaded = true;
    this.spinner.hide();
  }

  async onCommandClick(args: CommandClickEventArgs) {
    const rowData = args.rowData as FluentFormEntry;
    if (args.commandColumn.title === 'Details') {
      await this.router.navigate([rowData.id], {relativeTo: this.route});
    }
  }
}
