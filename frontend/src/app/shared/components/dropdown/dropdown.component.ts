import {
  AfterContentInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChildren,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostListener,
  Input,
  Output,
  QueryList,
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-dropdown-option',
  standalone: true,
  template: `<ng-template><ng-content></ng-content></ng-template>`,
})
export class DropdownOptionComponent {
  @Input() value: unknown;
  @Input() disabled = false;
  @Input() label = '';
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
  imports: [CommonModule, FormsModule],
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
        type="button"
        class="dropdown-trigger"
        [disabled]="disabled"
        [attr.aria-expanded]="open"
        [attr.aria-label]="ariaLabel || placeholder"
        (click)="toggle($event)"
        (blur)="handleBlur()"
        (keydown)="handleTriggerKeydown($event)">
        <span class="dropdown-value" [class.placeholder]="!selectedLabel">
          {{ selectedLabel || placeholder }}
        </span>
        <span class="dropdown-icon">expand_more</span>
      </button>

      <div class="dropdown-panel" *ngIf="open">
        <button
          type="button"
          class="dropdown-item"
          *ngFor="let option of optionList; let index = index"
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
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: inline-block;
      width: 100%;
      position: relative;
    }

    :host(.form-control) {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      min-height: 0;
    }

    :host(.form-control):focus {
      box-shadow: none;
    }

    .dropdown-shell {
      position: relative;
      width: 100%;
    }

    .dropdown-trigger {
      width: 100%;
      min-height: 40px;
      padding: 10px 36px 10px 14px;
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
      gap: 12px;
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

    .dropdown-value {
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.25;
    }

    .dropdown-value.placeholder {
      color: #9CA3AF;
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
      margin-right: -4px;
    }

    .dropdown-shell.open .dropdown-icon {
      transform: rotate(180deg);
    }

    .dropdown-panel {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 100%;
      width: max-content;
      max-width: min(90vw, 720px);
      z-index: 80;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      padding: 6px;
      max-height: 260px;
      overflow-y: auto;
    }

    .dropdown-item {
      width: 100%;
      min-width: 100%;
      border: 0;
      background: transparent;
      border-radius: var(--radius-sm);
      color: var(--blue-900);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font: inherit;
      padding: 10px 12px;
      text-align: left;
      transition: var(--transition);
    }

    .dropdown-item:hover:not(:disabled),
    .dropdown-item.active:not(:disabled) {
      background: var(--blue-50);
      color: var(--primary);
    }

    .dropdown-item.selected {
      background: linear-gradient(135deg, rgba(33, 150, 243, 0.16), rgba(66, 165, 245, 0.08));
      color: var(--primary);
      font-weight: 600;
    }

    .dropdown-item:disabled {
      color: #9CA3AF;
      cursor: not-allowed;
    }

    .dropdown-item-label {
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.25;
    }

    .dropdown-item-check {
      color: var(--primary);
    }

    :host(.table-page-size-select) .dropdown-trigger,
    :host(.select-compact) .dropdown-trigger {
      min-height: 32px;
      padding-top: 4px;
      padding-bottom: 4px;
    }

    :host(.table-page-size-select) .dropdown-panel {
      top: auto;
      bottom: calc(100% + 6px);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropdownComponent implements ControlValueAccessor, AfterContentInit {
  @Input() placeholder = 'Select an option';
  @Input() ariaLabel = '';
  @Output() change = new EventEmitter<unknown>();
  @ContentChildren(DropdownOptionComponent) options!: QueryList<DropdownOptionComponent>;

  disabled = false;
  open = false;
  activeIndex = -1;
  selectedLabel = '';
  private internalValue: unknown;
  private onChange: (value: unknown) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor(
    private host: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  ngAfterContentInit(): void {
    this.options.changes.subscribe(() => {
      this.syncActiveIndex();
      this.syncSelectedLabel();
      this.cdr.markForCheck();
    });
    this.syncActiveIndex();
    this.syncSelectedLabel();
  }

  get optionList(): DropdownOptionComponent[] {
    return this.options?.toArray() ?? [];
  }

  get selectedOption(): DropdownOptionComponent | undefined {
    return this.optionList.find(option => this.valuesMatch(option.actualValue, this.internalValue));
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
    if (disabled) {
      this.open = false;
    }
    this.cdr.markForCheck();
  }

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.disabled) {
      return;
    }

    this.open = !this.open;
    if (this.open) {
      this.syncActiveIndex();
    }
  }

  selectOption(option: DropdownOptionComponent, event?: Event): void {
    event?.stopPropagation();
    if (option.disabled) {
      return;
    }

    this.internalValue = option.actualValue;
    this.onChange(this.internalValue);
    this.onTouched();
    this.change.emit(this.internalValue);
    this.open = false;
    this.syncActiveIndex();
    this.syncSelectedLabel();
    this.cdr.markForCheck();
  }

  isSelected(value: unknown): boolean {
    return this.valuesMatch(value, this.internalValue);
  }

  handleBlur(): void {
    this.onTouched();
  }

  handleTriggerKeydown(event: KeyboardEvent): void {
    if (this.disabled) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.open && this.activeIndex >= 0) {
        const activeOption = this.optionList[this.activeIndex];
        if (activeOption) {
          this.selectOption(activeOption);
        }
        return;
      }
      this.open = true;
      this.syncActiveIndex();
      this.cdr.markForCheck();
      return;
    }

    if (event.key === 'Escape') {
      this.open = false;
      this.cdr.markForCheck();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open) {
        this.open = true;
      }
      this.moveActiveIndex(event.key === 'ArrowDown' ? 1 : -1);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
      this.cdr.markForCheck();
    }
  }

  private moveActiveIndex(step: number): void {
    const enabledOptions = this.optionList
      .map((option, index) => ({ option, index }))
      .filter(entry => !entry.option.disabled);

    if (!enabledOptions.length) {
      return;
    }

    const currentIndex = enabledOptions.findIndex(entry => entry.index === this.activeIndex);
    const nextIndex = currentIndex === -1
      ? (step > 0 ? 0 : enabledOptions.length - 1)
      : (currentIndex + step + enabledOptions.length) % enabledOptions.length;

    this.activeIndex = enabledOptions[nextIndex].index;
    this.cdr.markForCheck();
  }

  private syncActiveIndex(): void {
    const selectedIndex = this.optionList.findIndex(option => this.isSelected(option.actualValue) && !option.disabled);
    this.activeIndex = selectedIndex >= 0 ? selectedIndex : this.optionList.findIndex(option => !option.disabled);
  }

  private syncSelectedLabel(): void {
    const matchedOption = this.optionList.find(option => this.valuesMatch(option.actualValue, this.internalValue));
    if (matchedOption) {
      this.selectedLabel = matchedOption.displayText;
      return;
    }

    this.selectedLabel = this.internalValue == null || this.internalValue === ''
      ? ''
      : String(this.internalValue);
  }

  private valuesMatch(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }

    if (left == null || right == null) {
      return left == right;
    }

    if (typeof left === 'object' || typeof right === 'object') {
      return false;
    }

    return String(left) === String(right);
  }
}