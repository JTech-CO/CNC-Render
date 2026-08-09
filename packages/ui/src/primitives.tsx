"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type DialogHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "primary" | "secondary" | "danger";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className = "", variant = "secondary", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        className={`ui-button ui-button--${variant} ${className}`.trim()}
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);

export interface DialogProps
  extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "open"> {
  readonly open: boolean;
  readonly onDismiss: () => void;
  readonly title: string;
  readonly children: ReactNode;
}

export function Dialog({
  open,
  onDismiss,
  title,
  children,
  className = "",
  ...props
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={titleId}
      className={`ui-dialog ${className}`.trim()}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      ref={dialogRef}
      {...props}
    >
      <header className="ui-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <Button aria-label="대화상자 닫기" onClick={onDismiss}>
          닫기
        </Button>
      </header>
      <div className="ui-dialog__body">{children}</div>
    </dialog>
  );
}

export interface TabItem<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
  readonly badge?: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps<TValue extends string> {
  readonly ariaLabel: string;
  readonly idBase?: string;
  readonly items: readonly TabItem<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
}

export function Tabs<TValue extends string>({
  ariaLabel,
  idBase,
  items,
  value,
  onChange,
}: TabsProps<TValue>) {
  const generatedBaseId = useId();
  const baseId = idBase ?? generatedBaseId;
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not(:disabled)',
      ) ?? [],
    );
    if (tabs.length === 0) {
      return;
    }
    const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) {
      return;
    }
    event.preventDefault();
    nextTab.focus();
    nextTab.click();
  };
  return (
    <div aria-label={ariaLabel} className="ui-tabs" role="tablist">
      {items.map((item) => (
        <button
          aria-controls={`${baseId}-panel-${item.value}`}
          aria-selected={item.value === value}
          disabled={item.disabled}
          id={`${baseId}-tab-${item.value}`}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={handleKeyDown}
          role="tab"
          tabIndex={item.value === value ? 0 : -1}
          type="button"
        >
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}

export interface UnitInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label: string;
  readonly unit: string;
}

export const UnitInput = forwardRef<HTMLInputElement, UnitInputProps>(
  function UnitInput({ id, label, unit, className = "", ...props }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    return (
      <label
        className={`ui-unit-input ${className}`.trim()}
        htmlFor={inputId}
      >
        <span>{label}</span>
        <span className="ui-unit-input__control">
          <input id={inputId} inputMode="decimal" ref={ref} type="text" {...props} />
          <span aria-hidden="true">{unit}</span>
        </span>
      </label>
    );
  },
);

export interface ParameterRowProps {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

export function ParameterRow({ label, hint, children }: ParameterRowProps) {
  return (
    <div className="ui-parameter-row">
      <div>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

export interface DataTableColumn<TRow> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: TRow) => ReactNode;
  readonly numeric?: boolean;
}

export interface DataTableProps<TRow> {
  readonly caption: string;
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly getRowKey: (row: TRow) => string;
}

export function DataTable<TRow>({
  caption,
  columns,
  rows,
  getRowKey,
}: DataTableProps<TRow>) {
  return (
    <div className="ui-data-table-scroll" tabIndex={0}>
      <table className="ui-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((column) => (
                <td
                  className={column.numeric ? "ui-data-table__numeric" : undefined}
                  key={column.key}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
