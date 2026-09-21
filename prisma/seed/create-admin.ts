/**
 * Create or update a real admin account.
 *
 *   npm run db:create-admin
 *
 * Prompts for the password rather than taking it as an argument or an
 * environment variable: a password on a command line lands in shell history and
 * in the process list, where other users on the machine can read it.
 *
 * The account created here is NOT the demo account. It is never touched by
 * prisma/seed/demo.ts, which refuses to run against a user that is not isDemo.
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { hashPassword, MIN_PASSWORD_LENGTH } from '../../src/server/auth/password.ts'

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) throw new Error('Neither DIRECT_URL nor DATABASE_URL is set. See .env.example.')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

/**
 * Account details, from a prompt or from the environment.
 *
 * INTERACTIVE is the normal path: the password is typed and never echoed, so it
 * is not left on screen and never reaches shell history or the process list.
 *
 * NON-INTERACTIVE (a script, CI) reads ADMIN_USERNAME and ADMIN_PASSWORD from the
 * environment instead. Piping answers into the prompt was tried first and is not
 * reliable: readline stalls on the second question once stdin is not a terminal.
 * An environment variable is also a better shape for automation than a command
 * argument, which other users can read from the process list.
 */
type AdminInput = { username: string; password: string }

async function fromPrompt(): Promise<AdminInput> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true })

  const hidden = async (prompt: string): Promise<string> => {
    // Let readline echo, then erase the line and reprint the prompt after every
    // keystroke, so typed characters are overwritten as fast as they appear.
    const redraw = () => stdout.write('\u001B[2K\u001B[200D' + prompt)
    const pending = rl.question(prompt)
    stdin.on('data', redraw)
    try {
      return await pending
    } finally {
      stdin.off('data', redraw)
      stdout.write('\n')
    }
  }

  try {
    const username = (await rl.question('Username: ')).trim()
    const password = await hidden('Password: ')
    const again = await hidden('Confirm password: ')
    if (password !== again) throw new Error('Passwords did not match.')
    return { username, password }
  } finally {
    rl.close()
  }
}

function fromEnvironment(): AdminInput {
  const username = (process.env.ADMIN_USERNAME ?? '').trim()
  const password = process.env.ADMIN_PASSWORD ?? ''
  if (!username || !password) {
    throw new Error(
      'Not running on a terminal, so there is nothing to prompt. ' +
        'Set ADMIN_USERNAME and ADMIN_PASSWORD, or run this from a terminal.',
    )
  }
  return { username, password }
}

async function main() {
  const { username, password } = stdin.isTTY ? await fromPrompt() : fromEnvironment()

  if (!username) throw new Error('Username cannot be empty.')
  if (username === 'demo') {
    throw new Error('"demo" is the seeded demo account. Choose a different username.')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  const passwordHash = await hashPassword(password)

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing?.isDemo) {
    throw new Error(`"${username}" is a demo account. Refusing to turn it into an admin.`)
  }

  await prisma.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, passwordHash, isDemo: false },
  })

  const user = await prisma.user.findUniqueOrThrow({ where: { username } })

  // Every account needs its own pot before it can fund a loan with its own money.
  const hasSelf = await prisma.lender.findFirst({ where: { userId: user.id, isSelf: true } })
  if (!hasSelf) {
    await prisma.lender.create({
      data: { userId: user.id, firstName: username, lastName: '(you)', isSelf: true },
    })
    console.log('Created your own lender pot.')
  }

  // A password change should not leave old sessions alive elsewhere.
  const removed = await prisma.session.deleteMany({ where: { userId: user.id } })
  if (removed.count > 0) console.log(`Signed out ${removed.count} existing session(s).`)

  console.log(existing ? `Updated password for "${username}".` : `Created admin "${username}".`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
