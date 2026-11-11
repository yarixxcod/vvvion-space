import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function SecretInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  disabled,
  maxLength,
  className,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  label?: string;
}) {
  const [shown, setShown] = useState(false);
  const action = shown ? "Скрыть пароль" : "Показать пароль";
  return (
    <div className="relative">
      <input
        className={cn("field pr-11", className)}
        type={shown ? "text" : "password"}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="press absolute inset-y-0 right-0 grid w-11 place-items-center text-muted disabled:opacity-40"
        aria-label={action}
        title={action}
        disabled={disabled}
        onClick={() => setShown((current) => !current)}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
