import {
  FileText,
  Inbox,
  LayoutDashboard,
  Trash2,
  Users,
  Contact,
  HandCoins,
  type LucideIcon,
} from 'lucide-react'

/**
 * One definition of the navigation, read by both the sidebar and the phone tab
 * bar. Two lists would drift, and the drift would be invisible until a section
 * existed in one place and not the other.
 */
export type NavItem = {
  href: string
  label: string
  /** Shorter label for the phone tab bar, where width is tight. */
  short: string
  icon: LucideIcon
  /** One of the four phone tabs. The rest live behind "More". */
  primary: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, primary: true },
  { href: '/loans', label: 'Loans', short: 'Loans', icon: HandCoins, primary: true },
  // Behind "More" on a phone since 2026-09-28: the Admin reaches for lenders'
  // money far more often than for the borrower list, and every borrower is a
  // tap away from their loan anyway.
  { href: '/borrowers', label: 'Borrowers', short: 'Borrowers', icon: Contact, primary: false },
  // Behind "More" on a phone, not in the tab bar. On the sidebar it sits under
  // Loans, which is where it belongs in the sequence: a request becomes a loan.
  { href: '/pending', label: 'Pending loans', short: 'Pending', icon: Inbox, primary: false },
  // The phone's People tab, at the Admin's request (2026-09-28). The tab bar
  // carries the Record button in its middle slot, so there is room for four
  // tabs around it, and Lenders took the one Borrowers had.
  { href: '/lenders', label: 'Lenders', short: 'People', icon: Users, primary: true },
  { href: '/reports', label: 'Reports', short: 'Reports', icon: FileText, primary: false },
  { href: '/deleted', label: 'Recently Deleted', short: 'Deleted', icon: Trash2, primary: false },
]

/** A tab is active for its own route and anything beneath it — but "/" only exactly. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
