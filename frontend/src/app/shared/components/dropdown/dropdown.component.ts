import {
  AfterContentInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChildren,
  ElementRef,
  EventEmitter,
  forwardRef,
  Input,
  OnDestroy,
  Output,
  QueryList,
  TemplateRef,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { ConnectedPosition, Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Subscription } from 'rxjs';

interface CustomDropdownEntry {
  value: string;
  label: string;
}

const DROPDOWN_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 5 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 5 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -5 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -5 },
];

@Component({
  selector: 'app-dropdown-option',
  standalone: true,
  template: `<ng-template><ng-content></ng-content></ng-template>`,
})
export class DropdownOptionComponent {
  @Input() value: unknown;
  @Input() disabled = false;
  @Input() label = '';
  /** Optional extra keywords (e.g. part number, SKU, serial number) matched by live search. */
  @Input() searchText = '';
  @ViewChild(TemplateRef, { static: true }) templateRef!: TemplateRef<unknown>;

  private hasNgValue = false;
  private ngValueInternal: unknown;

  @Input('ngValue')
  set ngValue(value: unknown) {
    this.hasNgValue = true;
    this.ngValueInternal = value;
  }

  constructor(private host: ElementRef<HTMLElement>) {}

  get actualValue(): unknown {
    return this.hasNgValue ? this.ngValueInternal : this.value;
  }

  get displayText(): string {
    const explicitLabel = this.label.trim();
    if (explicitLabel) {
      return explicitLabel;
    }

    const templateText = this.resolveTemplateText();
    if (templateText) {
      return templateText;
    }

    const text = this.host.nativeElement.textContent ?? '';
    return text.replace(/\s+/g, ' ').trim();
  }

  get searchableText(): string {
    return `${this.displayText} ${this.searchText || ''}`.toLowerCase();
  }

  private resolveTemplateText(): string {
    const view = this.templateRef.createEmbeddedView({} as never);
    view.detectChanges();

    const text = view.rootNodes
      .map(node => (node.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    view.destroy();
    return text;
  }
}

@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [CommonModule, FormsModule, OverlayModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DropdownComponent),
      multi: true,
    },
  ],
  template: `
    <div class="dropdown-shell" [class.open]="open" [class.disabled]="disabled">
      <button
        #triggerOrigin
        type="button"
        class="dropdown-trigger"
        [disabled]="disabled"
        [attr.aria-expanded]="open"
        [attr.aria-label]="ariaLabel || placeholder"
        [title]="selectedLabel || placeholder"
        (click)="toggle($event)"
        (blur)="handleBlur()"
        (keydown)="handleTriggerKeydown($event)">
        <span class="dropdown-value" [class.placeholder]="!selectedLabel">
          {{ selectedLabel || placeholder }}
        </span>
        <span class="dropdown-icon">expand_more</span>
      </button>
    </div>

    <ng-template #panelTpl>
      <div
        class="dropdown-overlay-panel"
        [style.minWidth.px]="panelMinWidth"
        (click)="$event.stopPropagation()"
        (keydown)="handlePanelKeydown($event)">

        <!-- Live Search Bar -->
        <div class="dropdown-search-wrap" *ngIf="showSearchBar">
          <span class="dropdown-search-ico">search</span>
          <input
            #searchInput
            type="text"
            class="dropdown-search-input"
            [(ngModel)]="searchQuery"
            (ngModelChange)="onSearchChange()"
            [placeholder]="searchPlaceholder"
            aria-label="Filter dropdown options" />
          <button
            *ngIf="searchQuery"
            type="button"
            class="dropdown-search-clear"
            (click)="clearSearch()"
            title="Clear search">
            <span>close</span>
          </button>
        </div>

        <!-- Option List -->
        <div class="dropdown-options-scroll">
          <button
            type="button"
            class="dropdown-item"
            *ngFor="let option of filteredOptions; let index = index"
            [class.selected]="isSelected(option.actualValue)"
            [class.active]="index === activeIndex"
            [disabled]="option.disabled"
            (click)="selectOption(option, $event)"
            (mouseenter)="activeIndex = index">
            <span class="dropdown-item-label">
              <ng-container [ngTemplateOutlet]="option.templateRef"></ng-container>
            </span>
            <span class="dropdown-item-check" *ngIf="isSelected(option.actualValue)">check</span>
          </button>

          <!-- Locally Created Custom Options -->
          <button
            type="button"
            class="dropdown-item dropdown-item-custom"
            *ngFor="let custom of filteredCustomOptions"
            [class.selected]="isSelected(custom.value)"
            (click)="selectCustomOption(custom, $event)">
            <span class="dropdown-item-label">{{ custom.label }}</span>
            <span class="dropdown-item-check" *ngIf="isSelected(custom.value)">check</span>
          </button>

          <div class="dropdown-empty" *ngIf="filteredOptions.length === 0 && filteredCustomOptions.length === 0">
            No matching items found.
          </div>
        </div>

        <!-- Inline "+ Create New" Footer -->
        <div class="dropdown-create-footer" *ngIf="creatable">
          <button
            *ngIf="canQuickCreateFromSearch && !showInlineCreate"
            type="button"
            class="dropdown-create-quick-btn"
            (click)="commitCreate(searchQuery)">
            <span class="dropdown-create-ico">add_circle</span>
            <span class="dropdown-create-txt">{{ createLabel }}: <strong>"{{ searchQuery.trim() }}"</strong></span>
          </button>

          <button
            *ngIf="!canQuickCreateFromSearch && !showInlineCreate"
            type="button"
            class="dropdown-create-trigger-btn"
            (click)="openInlineCreate($event)">
            <span class="dropdown-create-ico">add</span>
            <span>{{ createLabel }}</span>
          </button>

          <div class="dropdown-create-form" *ngIf="showInlineCreate">
            <input
              #createInput
              type="text"
              class="dropdown-create-input"
              [(ngModel)]="newOptionDraft"
              [placeholder]="createPlaceholder"
              (keydown.enter)="$event.preventDefault(); commitCreate(newOptionDraft)"
              (keydown.escape)="$event.stopPropagation(); showInlineCreate = false" />
            <button
              type="button"
              class="dropdown-create-save"
              [disabled]="!newOptionDraft.trim()"
              (click)="commitCreate(newOptionDraft)">
              Add
            </button>
          </div>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      position: relative;
    }

    :host(.form-control) {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      min-height: 0;
      height: auto;
    }

    :host(.form-control):focus {
      box-shadow: none;
    }

    .dropdown-shell {
      position: relative;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    .dropdown-trigger {
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 40px;
      height: auto;
      padding: 8px 12px;
      border: 1.5px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-sans);
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--blue-900);
      background: var(--surface);
      text-align: left;
      cursor: pointer;
      transition: var(--transition);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .dropdown-trigger:hover:not(:disabled) {
      border-color: var(--blue-300);
      background: var(--blue-50);
    }

    .dropdown-trigger:focus-visible,
    .dropdown-shell.open .dropdown-trigger {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.12);
      outline: none;
    }

    .dropdown-trigger:disabled {
      background: var(--background);
      cursor: not-allowed;
    }

    /* Full readable wrapping inside forms & dialogs so long labels are never cut off */
    .dropdown-value {
      min-width: 0;
      flex: 1;
      white-space: normal;
      overflow-wrap: break-word;
      word-break: break-word;
      line-height: 1.3;
    }

    .dropdown-value.placeholder {
      color: var(--text-subtle);
    }

    /* Keep toolbar / compact table selects single-line to preserve row height */
    :host(.table-page-size-select) .dropdown-value,
    :host(.select-compact) .dropdown-value,
    :host(.lead-dd) .dropdown-value,
    :host(.ops-filter-select) .dropdown-value,
    :host(.sim-filter-select) .dropdown-value,
    :host(.sim-card-status-dd) .dropdown-value,
    :host(.status-select) .dropdown-value {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dropdown-icon,
    .dropdown-item-check {
      font-family: 'Material Icons Round';
      font-style: normal;
      font-size: 18px;
      line-height: 1;
      flex: 0 0 auto;
    }

    .dropdown-icon {
      color: var(--primary);
      transition: transform 0.2s ease;
    }

    .dropdown-shell.open .dropdown-icon {
      transform: rotate(180deg);
    }

    :host(.table-page-size-select) .dropdown-trigger,
    :host(.select-compact) .dropdown-trigger {
      min-height: 32px;
      padding-top: 4px;
      padding-bottom: 4px;
    }

    /* ── CDK Overlay Panel (never clipped by modal/card overflow) ─────────── */
    .dropdown-overlay-panel {
      display: flex;
      flex-direction: column;
      width: max-content;
      max-width: min(560px, calc(100vw - 24px));
      max-height: min(360px, calc(100vh - 32px));
      background: var(--surface, #ffffff);
      border: 1px solid var(--border, #cbd5e1);
      border-radius: var(--radius-md, 10px);
      box-shadow: 0 12px 32px rgba(10, 22, 40, 0.18), 0 2px 6px rgba(10, 22, 40, 0.08);
      overflow: hidden;
      font-family: var(--font-sans);
    }

    .dropdown-search-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border, #e2e8f0);
      background: var(--surface-raised, #f8fafc);
      flex-shrink: 0;
    }

    .dropdown-search-ico {
      font-family: 'Material Icons Round';
      font-size: 17px;
      color: var(--text-subtle, #64748b);
      flex-shrink: 0;
    }

    .dropdown-search-input {
      flex: 1;
      min-width: 140px;
      border: none;
      background: transparent;
      font-family: var(--font-sans);
      font-size: 0.84rem;
      color: var(--blue-950, #0a1628);
      outline: none;
    }

    .dropdown-search-clear {
      width: 22px;
      height: 22px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--text-subtle, #64748b);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
    }

    .dropdown-search-clear span {
      font-family: 'Material Icons Round';
      font-size: 15px;
    }

    .dropdown-search-clear:hover {
      background: var(--border, #e2e8f0);
      color: var(--blue-950, #0a1628);
    }

    .dropdown-options-scroll {
      overflow-y: auto;
      padding: 6px;
      flex: 1 1 auto;
      min-height: 0;
    }

    .dropdown-item {
      width: 100%;
      min-width: 100%;
      border: 0;
      background: transparent;
      border-radius: var(--radius-sm, 6px);
      color: var(--blue-900, #0f172a);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-family: var(--font-sans);
      font-size: 0.88rem;
      line-height: 1.35;
      padding: 9px 11px;
      text-align: left;
      transition: background 0.12s ease, color 0.12s ease;
    }

    .dropdown-item:hover:not(:disabled),
    .dropdown-item.active:not(:disabled) {
      background: var(--blue-50, #eff6ff);
      color: var(--primary, #1565c0);
    }

    .dropdown-item.selected {
      background: linear-gradient(135deg, rgba(33, 150, 243, 0.16), rgba(66, 165, 245, 0.08));
      color: var(--primary, #1565c0);
      font-weight: 600;
    }

    .dropdown-item:disabled {
      color: var(--text-subtle, #94a3b8);
      cursor: not-allowed;
    }

    .dropdown-item-label {
      min-width: 0;
      flex: 1;
      white-space: normal;
      overflow-wrap: break-word;
      word-break: break-word;
      line-height: 1.35;
    }

    .dropdown-item-check {
      color: var(--primary, #1565c0);
    }

    .dropdown-empty {
      padding: 14px 12px;
      text-align: center;
      font-size: 0.82rem;
      color: var(--text-muted, #64748b);
    }

    .dropdown-create-footer {
      border-top: 1px solid var(--border, #e2e8f0);
      background: var(--surface-raised, #f8fafc);
      padding: 6px;
      flex-shrink: 0;
    }

    .dropdown-create-trigger-btn,
    .dropdown-create-quick-btn {
      width: 100%;
      border: 1px dashed var(--blue-300, #93c5fd);
      border-radius: var(--radius-sm, 6px);
      background: var(--blue-50, #eff6ff);
      color: var(--primary, #1565c0);
      font-family: var(--font-sans);
      font-size: 0.82rem;
      font-weight: 700;
      padding: 7px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease, border-color 0.12s ease;
    }

    .dropdown-create-trigger-btn:hover,
    .dropdown-create-quick-btn:hover {
      background: var(--blue-100, #dbeafe);
      border-style: solid;
      border-color: var(--primary, #1565c0);
    }

    .dropdown-create-ico {
      font-family: 'Material Icons Round';
      font-size: 16px;
      flex-shrink: 0;
    }

    .dropdown-create-txt {
      white-space: normal;
      overflow-wrap: break-word;
    }

    .dropdown-create-form {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .dropdown-create-input {
      flex: 1;
      min-width: 140px;
      height: 32px;
      padding: 0 9px;
      border: 1px solid var(--border-focus, #2196f3);
      border-radius: var(--radius-sm, 6px);
      background: var(--surface, #ffffff);
      font-family: var(--font-sans);
      font-size: 0.83rem;
      color: var(--blue-950, #0a1628);
      outline: none;
    }

    .dropdown-create-save {
      height: 32px;
      padding: 0 12px;
      border: none;
      border-radius: var(--radius-sm, 6px);
      background: var(--primary, #1565c0);
      color: #ffffff;
      font-family: var(--font-sans);
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
    }

    .dropdown-create-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropdownComponent implements ControlValueAccessor, AfterContentInit, OnDestroy {
  @Input() placeholder = 'Select an option';
  @Input() ariaLabel = '';
  @Input() searchable: boolean | null = null;
  @Input() searchPlaceholder = 'Search…';
  @Input() creatable = false;
  @Input() createLabel = 'Add new option';
  @Input() createPlaceholder = 'Type new value…';
  /** Optional key to persist locally created string options in localStorage. */
  @Input() storageKey = '';

  @Output() change = new EventEmitter<unknown>();
  @Output() createOption = new EventEmitter<string>();

  @ContentChildren(DropdownOptionComponent) options!: QueryList<DropdownOptionComponent>;
  @ViewChild('triggerOrigin', { static: true }) triggerOrigin!: ElementRef<HTMLElement>;
  @ViewChild('panelTpl', { static: true }) panelTpl!: TemplateRef<unknown>;
  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('createInput') createInputRef?: ElementRef<HTMLInputElement>;

  disabled = false;
  open = false;
  activeIndex = -1;
  selectedLabel = '';
  panelMinWidth = 220;

  searchQuery = '';
  showInlineCreate = false;
  newOptionDraft = '';

  filteredOptions: DropdownOptionComponent[] = [];
  customOptions: CustomDropdownEntry[] = [];
  filteredCustomOptions: CustomDropdownEntry[] = [];

  private internalValue: unknown;
  private overlayRef: OverlayRef | null = null;
  private overlaySubs = new Subscription();
  private contentSub?: Subscription;
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private onChange: (value: unknown) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor(
    private overlay: Overlay,
    private vcr: ViewContainerRef,
    private cdr: ChangeDetectorRef,
  ) {}

  ngAfterContentInit(): void {
    this.loadStoredCustomOptions();
    this.contentSub = this.options.changes.subscribe(() => {
      this.rebuildFiltered();
      this.syncActiveIndex();
      this.syncSelectedLabel();
      this.cdr.markForCheck();
    });
    this.rebuildFiltered();
    this.syncActiveIndex();
    this.syncSelectedLabel();
  }

  ngOnDestroy(): void {
    this.closePanel();
    this.contentSub?.unsubscribe();
  }

  get optionList(): DropdownOptionComponent[] {
    return this.options?.toArray() ?? [];
  }

  get showSearchBar(): boolean {
    if (this.searchable === true) return true;
    if (this.searchable === false) return false;
    return this.creatable || this.optionList.length >= 7;
  }

  get canQuickCreateFromSearch(): boolean {
    const q = this.searchQuery.trim();
    if (!this.creatable || !q) return false;
    const ql = q.toLowerCase();
    const existsInOptions = this.optionList.some(o => o.displayText.toLowerCase() === ql);
    const existsInCustom = this.customOptions.some(c => c.label.toLowerCase() === ql);
    return !existsInOptions && !existsInCustom;
  }

  writeValue(value: unknown): void {
    this.internalValue = value;
    this.syncActiveIndex();
    this.syncSelectedLabel();
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
    if (disabled && this.open) {
      this.closePanel();
    }
    this.cdr.markForCheck();
  }

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.disabled) return;
    if (this.open) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  openPanel(): void {
    if (this.disabled || this.open) return;

    const triggerWidth = this.triggerOrigin?.nativeElement?.getBoundingClientRect().width || 220;
    this.panelMinWidth = Math.max(Math.round(triggerWidth), 200);
    this.searchQuery = '';
    this.showInlineCreate = false;
    this.newOptionDraft = '';
    this.rebuildFiltered();
    this.syncActiveIndex();

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.triggerOrigin)
      .withPositions(DROPDOWN_POSITIONS)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withViewportMargin(10);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });

    this.overlaySubs.unsubscribe();
    this.overlaySubs = new Subscription();

    this.overlaySubs.add(
      this.overlayRef.backdropClick().subscribe(() => this.closePanel())
    );
    this.overlaySubs.add(
      this.overlayRef.keydownEvents().subscribe((ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          this.closePanel();
        }
      })
    );

    const portal = new TemplatePortal(this.panelTpl, this.vcr);
    this.overlayRef.attach(portal);
    this.open = true;
    this.cdr.markForCheck();

    if (this.showSearchBar) {
      this.scheduleFocus(() => this.searchInputRef?.nativeElement?.focus());
    }
  }

  closePanel(): void {
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.overlaySubs.unsubscribe();
    this.overlaySubs = new Subscription();
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    if (this.open) {
      this.open = false;
      this.showInlineCreate = false;
      this.searchQuery = '';
      this.onTouched();
      this.cdr.markForCheck();
    }
  }

  onSearchChange(): void {
    this.rebuildFiltered();
    this.activeIndex = this.filteredOptions.findIndex(o => !o.disabled);
    this.cdr.markForCheck();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.onSearchChange();
    this.searchInputRef?.nativeElement?.focus();
  }

  openInlineCreate(event: Event): void {
    event.stopPropagation();
    this.showInlineCreate = true;
    this.newOptionDraft = this.searchQuery.trim();
    this.cdr.markForCheck();
    this.scheduleFocus(() => this.createInputRef?.nativeElement?.focus());
  }

  commitCreate(rawValue: string): void {
    const label = String(rawValue || '').trim();
    if (!label) return;

    if (this.createOption.observed) {
      // Delegate creation to parent component (persists to DB and updates option list)
      this.closePanel();
      this.createOption.emit(label);
      return;
    }

    // Self-managed local creation mode: append to dropdown list, persist & select
    const existing = this.optionList.find(o => o.displayText.toLowerCase() === label.toLowerCase());
    if (existing) {
      this.selectOption(existing);
      return;
    }

    let custom = this.customOptions.find(c => c.label.toLowerCase() === label.toLowerCase());
    if (!custom) {
      custom = { value: label, label };
      this.customOptions = [...this.customOptions, custom];
      this.saveStoredCustomOptions();
    }
    this.selectCustomOption(custom);
  }

  selectOption(option: DropdownOptionComponent, event?: Event): void {
    event?.stopPropagation();
    if (option.disabled) return;

    this.internalValue = option.actualValue;
    this.onChange(this.internalValue);
    this.onTouched();
    this.change.emit(this.internalValue);
    this.closePanel();
    this.syncSelectedLabel();
    this.cdr.markForCheck();
  }

  selectCustomOption(custom: CustomDropdownEntry, event?: Event): void {
    event?.stopPropagation();
    this.internalValue = custom.value;
    this.onChange(this.internalValue);
    this.onTouched();
    this.change.emit(this.internalValue);
    this.closePanel();
    this.syncSelectedLabel();
    this.cdr.markForCheck();
  }

  isSelected(value: unknown): boolean {
    return this.valuesMatch(value, this.internalValue);
  }

  handleBlur(): void {
    if (!this.open) {
      this.onTouched();
    }
  }

  handleTriggerKeydown(event: KeyboardEvent): void {
    if (this.disabled) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!this.open) {
        this.openPanel();
      } else if (this.activeIndex >= 0 && this.filteredOptions[this.activeIndex]) {
        this.selectOption(this.filteredOptions[this.activeIndex]);
      }
      return;
    }

    if (event.key === 'Escape') {
      this.closePanel();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open) {
        this.openPanel();
      }
      this.moveActiveIndex(event.key === 'ArrowDown' ? 1 : -1);
    }
  }

  handlePanelKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveActiveIndex(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && !this.showInlineCreate) {
      if (this.activeIndex >= 0 && this.filteredOptions[this.activeIndex]) {
        event.preventDefault();
        this.selectOption(this.filteredOptions[this.activeIndex]);
      } else if (this.canQuickCreateFromSearch) {
        event.preventDefault();
        this.commitCreate(this.searchQuery);
      }
    }
  }

  private scheduleFocus(fn: () => void): void {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      fn();
    }, 0);
  }

  private rebuildFiltered(): void {
    const q = this.searchQuery.trim().toLowerCase();
    const list = this.optionList;
    this.filteredOptions = q
      ? list.filter(o => o.searchableText.includes(q))
      : list;
    this.filteredCustomOptions = q
      ? this.customOptions.filter(c => c.label.toLowerCase().includes(q))
      : this.customOptions;
  }

  private moveActiveIndex(step: number): void {
    const enabled = this.filteredOptions
      .map((option, index) => ({ option, index }))
      .filter(entry => !entry.option.disabled);

    if (!enabled.length) return;

    const currentIndex = enabled.findIndex(entry => entry.index === this.activeIndex);
    const nextIndex = currentIndex === -1
      ? (step > 0 ? 0 : enabled.length - 1)
      : (currentIndex + step + enabled.length) % enabled.length;

    this.activeIndex = enabled[nextIndex].index;
    this.cdr.markForCheck();
  }

  private syncActiveIndex(): void {
    const selectedIndex = this.filteredOptions.findIndex(o => this.isSelected(o.actualValue) && !o.disabled);
    this.activeIndex = selectedIndex >= 0 ? selectedIndex : this.filteredOptions.findIndex(o => !o.disabled);
  }

  private syncSelectedLabel(): void {
    const matchedOption = this.optionList.find(o => this.valuesMatch(o.actualValue, this.internalValue));
    if (matchedOption) {
      this.selectedLabel = matchedOption.displayText;
      return;
    }

    const matchedCustom = this.customOptions.find(c => this.valuesMatch(c.value, this.internalValue));
    if (matchedCustom) {
      this.selectedLabel = matchedCustom.label;
      return;
    }

    this.selectedLabel = this.internalValue == null || this.internalValue === ''
      ? ''
      : String(this.internalValue);
  }

  private loadStoredCustomOptions(): void {
    if (!this.storageKey) return;
    try {
      const raw = localStorage.getItem(`smart_dd_${this.storageKey}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.customOptions = parsed
          .filter(x => x && typeof x.value === 'string' && typeof x.label === 'string')
          .slice(0, 50);
      }
    } catch {
      // ignore storage failure
    }
  }

  private saveStoredCustomOptions(): void {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(`smart_dd_${this.storageKey}`, JSON.stringify(this.customOptions.slice(-50)));
    } catch {
      // ignore storage failure
    }
  }

  private valuesMatch(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (left == null || right == null) return left === right;
    if (typeof left === 'object' || typeof right === 'object') return false;
    return String(left) === String(right);
  }
}
