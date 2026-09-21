import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Types pesos. The server stores centavos.
 *
 * A text input, NOT type="number". Number inputs silently accept "1e5", scroll
 * the value when a wheel passes over them, and drop grouping commas the admin
 * naturally types — all on a field where the number is somebody's money.
 * inputMode="decimal" still brings up the numeric keypad on a phone, which is
 * the only thing type="number" was wanted for.
 *
 * Nothing is parsed here. src/lib/money/parsePesos owns that, so the browser and
 * the server can never disagree about what "30,000.5" meant.
 */
export function MoneyInput({
  name,
  label,
  defaultValue,
  placeholder = '0.00',
  required = true,
  className,
}: {
  name: string
  label: string
  defaultValue?: string
  placeholder?: string
  required?: boolean
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={name}>{label}</Label>
      <div className="relative">
        <span
          className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
          aria-hidden
        >
          ₱
        </span>
        <Input
          id={name}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          defaultValue={defaultValue}
          required={required}
          className="money-column pl-7"
        />
      </div>
    </div>
  )
}
