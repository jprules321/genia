import {Component, OnInit} from '@angular/core';
import {ActivatedRoute, RouterLink} from '@angular/router';
import {ButtonAllModule, CheckBoxAllModule} from '@syncfusion/ej2-angular-buttons';
import {ResponseData} from '../estimations/estimations.component';
import {EstimationService} from '../../providers/estimation.service';
import {firstValueFrom} from 'rxjs';
import {NgIf, TitleCasePipe, UpperCasePipe} from '@angular/common';
import {TextAreaAllModule, TextBoxAllModule} from '@syncfusion/ej2-angular-inputs';
import {SpinnerService} from '../../providers/spinner.service';
import {ToolbarAllModule} from '@syncfusion/ej2-angular-navigations';
import {DialogAllModule} from '@syncfusion/ej2-angular-popups';
import {FormsModule} from '@angular/forms';
import {RichTextEditorAllModule} from '@syncfusion/ej2-angular-richtexteditor';

export interface ICalculateQuoteResponse {
  data: IQuoteResults;
  message: string;
  status: string;
}

export interface IQuoteResults {
  type_batiment: string;
  superficie?: string;
  hauteur_mur?: string;
  perimetre?: string;
  plancher: {
    type?: string;
    prix?: string;
    metreBeton: number;
  };
  isolation_plancher: {
    nombre_feuilles: number;
    prix?: string;
  };
  murs: {
    type_materiaux?: string;
    longeur_materiaux: number;
    nombre_materiaux: number;
    prix_materiaux: number;
    nombre_lattes: number;
    prix_lattes: number;
    nombre_rip_716: number;
    prix_rip_716: number;
    nombre_tyvek: number;
    prix_tyvek: number;
    type_revetement?: string;
    couleur_revetement?: string;
    longeur_tole: number;
    nombre_revetement: number;
    prix_revetement: number;
    prix_revetement_coins: number;
  };
  toiture: {
    pente: number;
    longeur_thrust: number;
    type_revetement_toiture?: string;
    nombre_rip_58: number;
    prix_rip_58: number;
    nombre_paquet_bardeau: number;
    prix_bardeau: number;
    nombre_bande_depart: number;
    prix_bande_depart: number;
    nombre_thrust: number;
    nombre_tole: number;
    longeur_tole: number;
    prix_tole: number;
    prix_thrust: number;
    prix_sofit: number;
    prix_facia: number;
    prix_j_flashing: number;
  };
  fenetres: {
    nombre_fenetres: number;
    type_fenetres?: string;
    couleur_fenetres?: string;
    dimension_fenetres?: string;
    prix_fenetres: number;
  };
  portes: {
    garage: {
      nombre_portes_garage: number;
      couleur_portes_garage?: string;
      porte_garage_motorise?: string;
      type_de_moteur?: string;
      porte_avec_fenetres?: string;
      dimension_porte_garage_1?: string;
      dimension_porte_garage_2?: string;
      dimension_porte_garage_3?: string;
      dimension_porte_garage_4?: string;
      nombre_fenetres_porte_garage_1: string;
      nombre_fenetres_porte_garage_2: string;
      nombre_fenetres_porte_garage_3: string;
      nombre_fenetres_porte_garage_4: string;
      prix_portes_garage: number;
      prix_moteurs: number;
      prix_installation_portes_garage: number;
      prix_installation_moteurs: number;
      prix_fenetres_portes_garage: number;
    };
    pieton: {
      nombre_portes_pieton: number;
      couleur_portes_pieton?: string;
      type_fenetres_pieton?: string;
      prix_portes_pieton: number;
    };
  };
  construction: {
    prix_plancher: number;
    prix_coffrage: number;
    prix_atelier: number;
    prix_chantier: number;
    prix_divers: number;
  };
  total: {
    materiaux: number;
    maindoeuvre_dollar: number;
    maindoeuvre_heures: number;
    profit: number;
    total: number;
    taxe_tvq: number;
    taxe_tps: number;
    grand_total: number;
  };
  toCalculateMessages: {
    revetement_exterieur_metal: string;
    isolation_mur: string;
    plancher_bois: string;
    revetement_toiture_metal: string;
    toiture_versant: string;
    porte_garage_autre: string;
  };
}


@Component({
  selector: 'app-estimation-details',
  imports: [
    RouterLink,
    ButtonAllModule,
    NgIf,
    TextAreaAllModule,
    TextBoxAllModule,
    ToolbarAllModule,
    DialogAllModule,
    FormsModule,
    RichTextEditorAllModule,
    UpperCasePipe,
    TitleCasePipe,
    CheckBoxAllModule
  ],
  templateUrl: './estimation-details.component.html',
  styleUrl: './estimation-details.component.scss'
})
export class EstimationDetailsComponent implements OnInit {

  showPriceOnPrint = false;
  showModal = false;
  adjustmentOptions = ''; // Two-way binded to the WYSIWYG editor
  finalPrice = ''; // Two-way binded to the simple text input

  public entryId: string;
  public entryData: ResponseData;
  public quoteResults: IQuoteResults;

  constructor(private route: ActivatedRoute, private eService: EstimationService, private spinner : SpinnerService) {
    this.entryId = this.route.snapshot.paramMap.get('id');
  }

  async ngOnInit() {
    await this.getEntry();
    await this.calculateQuote();
  }

  public async getEntry() {
    this.spinner.show();
    const entryResponse = await firstValueFrom(this.eService.getEntry(Number(this.entryId)));
    if (!entryResponse) {
      alert('No entry found');
    }
    this.entryData = entryResponse;
    this.entryData['full_name'] = this.entryData?.names?.first_name + ' ' + this.entryData?.names?.last_name;
    if (this.entryData?.revetement_exterieur == 'Oui') {
      this.entryData.lattes_revetement = 'Oui';
    }
    this.entryData.porte_garage = Number(this.entryData.nombre_porte_garage) > 0 ? 'Oui' : 'Non';
    this.spinner.hide();
  }

  public async calculateQuote() {
    this.spinner.show();
    try {
      const response = await firstValueFrom(this.eService.calculateQuote(this.entryData));
      if (!response) {
        alert('Cannot calculate quote.');
      }
      this.quoteResults = response?.data;
      this.spinner.hide();
      console.log(this.quoteResults);
    } catch (e) {
      console.log(e);
      alert('Cannot calculate quote.');
      this.spinner.hide();
    }
  }

  public printDiv(divId: string) {
    const divToPrint = document.getElementById(divId);
    if (!divToPrint) return;

    const printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.open();

    // Get all styles and links from the original document
    const styles = Array.from(document.styleSheets)
      .map((styleSheet) => {
        try {
          return Array.from(styleSheet.cssRules)
            .map(rule => rule.cssText)
            .join("\n");
        } catch (error) {
          return ""; // Some stylesheets might be restricted due to CORS
        }
      })
      .join("\n")
    let finalStyles = `<style>${styles}</style>`;

    if (this.showPriceOnPrint) {
      finalStyles += `
    <style>
      .print-hide {
        display: block !important;
        visibility: visible !important;
        height: unset !important;
        margin: unset !important;
        padding: unset !important;
      }
      .dvh-65 {
      height: unset !important;
      }
    </style>
  `;
    }


    const links = Array.from(document.querySelectorAll("link[rel='stylesheet']"))
      // @ts-ignore
      .map(link => `<link rel="stylesheet" href="${link.href}">`)
      .join("\n");

    printWindow.document.write(`
    <html>
      <head>
        <title>Print</title>
        ${links}
        ${finalStyles}
        <style>
          body { font-size: 85%; }
          .tm_invoice_wrap { width: 100% !important; }
        </style>
      </head>
      <body>
        ${divToPrint.outerHTML}
      </body>
    </html>
  `);

    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  }

  protected readonly Number = Number;

  openWebsiteEstimation() {
    const url = `https://grdf.ca/wp-admin/admin.php?page=fluent_forms&route=entries&form_id=14#/entries/${this.entryId}`
    window.open(url, '_blank');
  }

  openModal() {
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
  }
}
