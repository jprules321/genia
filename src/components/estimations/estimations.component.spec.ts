import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EstimationsComponent } from './estimations.component';

describe('EstimationsComponent', () => {
  let component: EstimationsComponent;
  let fixture: ComponentFixture<EstimationsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EstimationsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EstimationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
