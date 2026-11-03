import { type FormState, NO_ERROR } from '../forms.ts'
import {
  clearBorrowerPhoto,
  createBorrower,
  deleteBorrower,
  renameBorrower,
  restoreBorrower,
  setBorrowerLabel,
} from '../borrowers/actions.ts'
import {
  createLender,
  deleteLender,
  deleteTransaction,
  recordAdvance,
  recordTransaction,
  renameLender,
  restoreLender,
  restoreTransaction,
  setStartingCapital,
  updateTransaction,
} from '../lenders/actions.ts'
import { addLoanNote, createLoan, deleteLoan, deleteLoanNote, restoreLoan, updateLoan } from '../loans/actions.ts'
import { convertToWeekly } from '../loans/convert.ts'
import { extendLoan, undoExtension } from '../loans/extend-actions.ts'
import { addLoanProof, deleteLoanProof } from '../loans/proof-actions.ts'
import { addProof, deleteProof, markPaid, undoPayment } from '../payments/actions.ts'
import { markWeekPaid, undoWeekPaid } from '../payments/week-actions.ts'
import { createPendingLoan, deletePendingLoan } from '../pending/actions.ts'
import { type ActionSpec } from './actions.ts'

/**
 * The server action behind each entry in the Ask Pondex catalog: the same
 * function the app's own form posts to. Kept apart from actions.ts because
 * these import Next's server-only modules, which the tests cannot load.
 */

const RUNNERS: Record<string, (prev: FormState, form: FormData) => Promise<FormState>> = {
  create_loan: createLoan,
  update_loan: updateLoan,
  delete_loan: deleteLoan,
  restore_loan: restoreLoan,
  extend_loan: extendLoan,
  undo_extension: undoExtension,
  convert_to_weekly: convertToWeekly,
  add_note: addLoanNote,
  delete_note: deleteLoanNote,
  add_loan_proof: addLoanProof,
  delete_loan_proof: deleteLoanProof,
  mark_paid: markPaid,
  undo_payment: undoPayment,
  mark_week_paid: markWeekPaid,
  undo_week_paid: undoWeekPaid,
  add_payment_proof: addProof,
  delete_payment_proof: deleteProof,
  create_borrower: createBorrower,
  rename_borrower: renameBorrower,
  set_label: setBorrowerLabel,
  delete_borrower: deleteBorrower,
  restore_borrower: restoreBorrower,
  clear_borrower_photo: clearBorrowerPhoto,
  create_lender: createLender,
  rename_lender: renameLender,
  set_starting_capital: setStartingCapital,
  delete_lender: deleteLender,
  restore_lender: restoreLender,
  record_money: recordTransaction,
  record_advance: recordAdvance,
  update_money: updateTransaction,
  delete_money: deleteTransaction,
  restore_money: restoreTransaction,
  create_request: createPendingLoan,
  delete_request: deletePendingLoan,
}

/** Run a confirmed action. A redirect is how some actions say "done", so it counts as success. */
export async function runAction(spec: ActionSpec, form: FormData): Promise<FormState> {
  const run = RUNNERS[spec.name]
  if (!run) return { error: 'That change is not available.' }
  try {
    return await run(NO_ERROR, form)
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return NO_ERROR
    throw error
  }
}
