import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A modal dialog that is actually modal.
 *
 * The previous implementation rendered inline with no portal, no
 * `role="dialog"`, no `aria-modal`, no accessible name, no focus trap and no
 * focus restore — so Tab walked straight out of the dialog into the page
 * behind it, screen readers announced nothing, and closing it left focus
 * nowhere.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Accessible name. Falls back to the DialogTitle's generated id. */
  label?: string
}

const Dialog = React.forwardRef<HTMLDivElement, DialogProps>(
  ({ className, open, onOpenChange, label, children, ...props }, forwardedRef) => {
    const panelRef = React.useRef<HTMLDivElement | null>(null)
    const restoreFocusTo = React.useRef<HTMLElement | null>(null)
    const titleId = React.useId()

    React.useEffect(() => {
      if (!open) return

      // Remember where focus was, so closing returns the user to where they were.
      restoreFocusTo.current = document.activeElement as HTMLElement | null

      const panel = panelRef.current
      // Move focus into the dialog; the panel itself is focusable as a fallback
      // when it contains no interactive element yet.
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel)?.focus()

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onOpenChange?.(false)
          return
        }
        if (event.key !== 'Tab' || !panel) return

        // Cycle focus within the dialog rather than letting it escape behind
        // the backdrop.
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (element) => element.offsetParent !== null,
        )
        if (focusable.length === 0) {
          event.preventDefault()
          return
        }

        const firstElement = focusable[0]
        const lastElement = focusable[focusable.length - 1]
        const active = document.activeElement

        if (event.shiftKey && (active === firstElement || active === panel)) {
          event.preventDefault()
          lastElement.focus()
        } else if (!event.shiftKey && active === lastElement) {
          event.preventDefault()
          firstElement.focus()
        }
      }

      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
        restoreFocusTo.current?.focus()
      }
    }, [open, onOpenChange])

    if (!open) return null

    // Portalled to the body, so the dialog is not clipped by an ancestor's
    // overflow and sits above everything regardless of stacking context.
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black/50"
          // Decorative; Escape and the close button are the accessible paths.
          aria-hidden="true"
          onClick={() => onOpenChange?.(false)}
        />

        <div
          ref={(node) => {
            panelRef.current = node
            if (typeof forwardedRef === 'function') forwardedRef(node)
            else if (forwardedRef) {
              const objectRef = forwardedRef as React.MutableRefObject<HTMLDivElement | null>
              objectRef.current = node
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-labelledby={label ? undefined : titleId}
          tabIndex={-1}
          className={cn(
            'relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg',
            'border bg-surface shadow-overlay outline-none',
            className,
          )}
          {...props}
        >
          <DialogTitleContext.Provider value={titleId}>{children}</DialogTitleContext.Provider>
        </div>
      </div>,
      document.body,
    )
  },
)
Dialog.displayName = 'Dialog'

/** Lets DialogTitle adopt the id the dialog points its aria-labelledby at. */
const DialogTitleContext = React.createContext<string | undefined>(undefined)

const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rule-b flex shrink-0 items-center justify-between px-4 py-3', className)}
      {...props}
    />
  ),
)
DialogHeader.displayName = 'DialogHeader'

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => {
    const id = React.useContext(DialogTitleContext)
    return <h2 ref={ref} id={id} className={cn('text-sm font-semibold', className)} {...props} />
  },
)
DialogTitle.displayName = 'DialogTitle'

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    // The only scrolling region, so the header and footer stay put.
    <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto p-4', className)} {...props} />
  ),
)
DialogContent.displayName = 'DialogContent'

const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rule-t flex shrink-0 items-center justify-end gap-2 px-4 py-3', className)}
      {...props}
    />
  ),
)
DialogFooter.displayName = 'DialogFooter'

const DialogClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...props}
  >
    {children}
  </button>
))
DialogClose.displayName = 'DialogClose'

/** The header's dismiss affordance. */
const DialogDismiss = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label="Close"
    className={cn(
      'flex h-7 w-7 items-center justify-center rounded text-muted-foreground',
      'transition-colors hover:bg-accent hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...props}
  >
    <X className="h-4 w-4" aria-hidden="true" />
  </button>
))
DialogDismiss.displayName = 'DialogDismiss'

export {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
  DialogClose,
  DialogDismiss,
}
