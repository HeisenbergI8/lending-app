import { type Prisma } from '@prisma/client'

import { db } from './db.ts'

/**
 * One name, one person.
 *
 * Nothing but a name is stored about a borrower or a lender, so the name IS the
 * identity — and two rows carrying it split one person's history in half. Their
 * loans, what they owe and their track record each land on whichever of the two
 * happened to be picked that day, and neither row is wrong enough to notice.
 * The dashboard then counts them as two borrowers.
 *
 * THE COMPARISON IGNORES CASE, because "angel cruz" typed on a phone at speed is
 * the same person as "Angel Cruz" and the keyboard is what differs, not the
 * borrower.
 *
 * A DELETED MATCH IS A DIFFERENT ANSWER, not the same refusal. Recently Deleted
 * keeps a person for thirty days, and a name that collides with one of those is
 * invisible on every list the admin can see — refusing with "already exists"
 * would be a message about a row she cannot find. Restoring is also the right
 * move there: it brings the loans back with the person, where adding a fresh row
 * would strand them.
 *
 * WHICH LEAVES RESTORE. Adding a fresh row while a deleted one holds the name is
 * allowed, so the deleted one can later be brought back onto a name that is now
 * taken — the double entry arriving by the one door that was not watched. So
 * restore asks too, and only about LIVE rows: a second deleted namesake is not
 * on any list and blocks nothing.
 *
 * TWO REAL PEOPLE CAN SHARE A NAME, and this refuses the second one. That is the
 * deliberate trade: in a ledger this size an accidental double entry is far more
 * likely than a genuine namesake, and the way through is to record what tells
 * them apart — a middle initial, a nickname — which is worth having on the row
 * anyway.
 */

export type Name = { firstName: string; lastName: string }
export type PersonKind = 'borrower' | 'lender'

/** Either the live client or one inside a transaction. The loan form needs the latter. */
type Client = typeof db | Prisma.TransactionClient

/**
 * The sentence shown when a name is already on the list.
 *
 * Pure, and separated from the query so the wording can be tested without a
 * database — `node --test` cannot reach Prisma, and the branching here is the
 * part worth pinning.
 */
export function duplicateMessage(kind: PersonKind, name: Name, deleted: boolean): string {
  const who = `${name.firstName} ${name.lastName}`
  return deleted
    ? `${who} is in Recently Deleted. Restore that ${kind} instead of adding a second one.`
    : `${who} is already a ${kind}. Open the one already on the list, or add something that tells the two apart.`
}

/** The sentence shown when a restore would collide with somebody live. */
export function restoreBlockedMessage(kind: PersonKind, name: Name): string {
  const who = `${name.firstName} ${name.lastName}`
  return `There is already a ${kind} called ${who}. Rename one of them before restoring this one.`
}

/** Case-insensitive, whole name, this account only. `exceptId` is the row being changed. */
function nameWhere(userId: string, name: Name, exceptId?: string, liveOnly = false) {
  return {
    userId,
    ...(exceptId ? { id: { not: exceptId } } : {}),
    ...(liveOnly ? { deletedAt: null } : {}),
    firstName: { equals: name.firstName, mode: 'insensitive' as const },
    lastName: { equals: name.lastName, mode: 'insensitive' as const },
  }
}

/** The sentence to refuse a create or rename with, or null when the name is free. */
export async function borrowerNameTaken(
  client: Client,
  userId: string,
  name: Name,
  exceptId?: string,
): Promise<string | null> {
  const found = await client.borrower.findFirst({
    where: nameWhere(userId, name, exceptId),
    select: { deletedAt: true },
  })
  return found ? duplicateMessage('borrower', name, found.deletedAt !== null) : null
}

/** The sentence to refuse a create or rename with, or null when the name is free. */
export async function lenderNameTaken(
  client: Client,
  userId: string,
  name: Name,
  exceptId?: string,
): Promise<string | null> {
  const found = await client.lender.findFirst({
    where: nameWhere(userId, name, exceptId),
    select: { deletedAt: true },
  })
  return found ? duplicateMessage('lender', name, found.deletedAt !== null) : null
}

/** The sentence to refuse a restore with, or null when nobody live holds the name. */
export async function borrowerRestoreBlocked(
  client: Client,
  userId: string,
  name: Name,
  exceptId: string,
): Promise<string | null> {
  const found = await client.borrower.findFirst({
    where: nameWhere(userId, name, exceptId, true),
    select: { id: true },
  })
  return found ? restoreBlockedMessage('borrower', name) : null
}

/** The sentence to refuse a restore with, or null when nobody live holds the name. */
export async function lenderRestoreBlocked(
  client: Client,
  userId: string,
  name: Name,
  exceptId: string,
): Promise<string | null> {
  const found = await client.lender.findFirst({
    where: nameWhere(userId, name, exceptId, true),
    select: { id: true },
  })
  return found ? restoreBlockedMessage('lender', name) : null
}
