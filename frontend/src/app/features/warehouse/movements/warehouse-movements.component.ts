import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { DateFilterService } from '../../../core/services/date-filter.service';
import {
  MovementType,
  StockMovement,
  WarehouseMovementTypeCounts
} from '../../../core/models/interfaces';
import { DropdownComponent, DropdownOptionComponent } from '../../../shared/components/dropdown/dropdown.component';
import {
  MOVEMENT_TYPES,
  formatMovementDelta,
  formatMovementUser,
  getMovementTypeMeta
} from '../warehouse-helpers';

@Component({
  selector: 'app-warehouse-movements',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, DropdownOptionComponent],
  templateUrl: './warehouse-movements.component.html',
  styleUrls: ['./warehouse-movements.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarehouseMovementsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() refreshTick = 0;

  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  private initialized = false;
  Math = Math;

  readonly movementTypes = MOVEMENT_TYPES;
  movements: StockMovement[] = [];
  typeCounts: WarehouseMovementTypeCounts = {
    ALL: 0,
    IN: 0,
    OUT: 0,
    TRANSFER: 0,
    ADJUSTMENT: 0,
    RETURN: 0
  };

  loading = true;
  search = '';
  typeFilter: 'ALL' | MovementType = 'ALL';
  page = 1;
  pageSize = 25;
  total = 0;
  readonly pageSizeOptions = [10, 25, 50, 100];

  constructor(
    private api: ApiService,
    private dateFilter: DateFilterService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.searchInput$
      .pipe(debounceTime(280), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(val => {
        this.search = val;
        this.page = 1;
        this.loadMovements();
      });

    this.dateFilter.range$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.page = 1;
        this.loadMovements();
      });

    this.initialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.initialized && changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.loadMovements();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMovements(): void {
    this.loading = true;
    this.api.get<any>('/warehouse/movements', {
      type: this.typeFilter !== 'ALL' ? this.typeFilter : '',
      search: this.search.trim(),
      page: this.page,
      limit: this.pageSize
    }).subscribe({
      next: r => {
        this.movements = r?.data?.movements || [];
        this.total = r?.data?.total ?? 0;
        if (r?.data?.type_counts) {
          this.typeCounts = r.data.type_counts;
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearchModelChange(val: string): void {
    this.search = val;
    this.searchInput$.next(val);
  }

  clearSearch(): void {
    this.search = '';
    this.searchInput$.next('');
    this.page = 1;
    this.loadMovements();
  }

  setTypeFilter(type: 'ALL' | MovementType): void {
    this.typeFilter = type;
    this.page = 1;
    this.loadMovements();
  }

  getTypeCount(type: 'ALL' | MovementType): number {
    return this.typeCounts[type] ?? 0;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  changePage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page = page;
    this.loadMovements();
  }

  onPageSizeChange(): void {
    this.page = 1;
    this.loadMovements();
  }

  movementMeta(type: MovementType) { return getMovementTypeMeta(type); }
  movementDelta(m: StockMovement): string { return formatMovementDelta(m); }
  movementUser(m: StockMovement): string { return formatMovementUser(m); }
}
