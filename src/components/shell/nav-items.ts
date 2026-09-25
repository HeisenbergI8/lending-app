import {
  FileText,
  Inbox,
  LayoutDashboard,
  Trash2,
  Users,
  Wallet,
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
  { href: '/borrowers', label: 'Borrowers', short: 'People', icon: Users, primary: true },
  // Behind "More" on a phone, not in the tab bar. On the sidebar it sits under
  // Loans, which is where it belongs in the sequence: a request becomes a loan.
  { href: '/pending', label: 'Pending loans', short: 'Pending', icon: Inbox, primary: false },
  // Also behind "More". The tab bar now carries the Record button in its middle
  // slot, which leaves room for four tabs around it rather than five, and the
  // pot balances this screen breaks down are already on the Dashboard.
  { href: '/lenders', label: 'Lenders', short: 'Funds', icon: Wallet, primary: false },
  { href: '/reports', label: 'Reports', short: 'Reports', icon: FileText, primary: false },
  { href: '/deleted', label: 'Recently Deleted', short: 'Deleted', icon: Trash2, primary: false },
]

/** A tab is active for its own route and anything beneath it — but "/" only exactly. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
