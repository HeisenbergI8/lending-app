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

/** Read a line without echoing it to the terminal, so it is not left on screen. */
async function readHidden(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  const wasRaw = stdin.isRaw
  stdout.write(prompt)

  const onKeypress = (char: Buffer) => {
    const c = char.toString()
    // Re-print the prompt so the cursor does not drift as characters arrive.
    if (c !== '\r' && c !== '\n') stdout.write('')
  }
  stdin.on('data', onKeypress)

  const muted = new Proxy(stdout, {
    get(target, property, receiver) {
      if (property === 'write') return () => true
      return Reflect.get(target, property, receiver)
    },
  })
  // @ts-expect-error swapping the output stream for the duration of the question
  rl.output = muted
  const answer = await rl.question('')
  // @ts-expect-error restoring it
  rl.output = stdout
  stdin.off('data', onKeypress)
  if (wasRaw !== undefined) stdin.isRaw = wasRaw
  stdout.write('\n')
  return answer
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout })

  try {
    const username = (await rl.question('Username: ')).trim()
    if (!username) throw new Error('Username cannot be empty.')

    if (username === 'demo') {
      throw new Error('"demo" is the seeded demo account. Choose a different username.')
    }

    const password = await readHidden(rl, 'Password: ')
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    }

    const again = await readHidden(rl, 'Confirm password: ')
    if (password !== again) throw new Error('Passwords did not match.')

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

    // Every account needs its own pot before it can fund a loan with its own money.
    const user = await prisma.user.findUniqueOrThrow({ where: { username } })
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
  } finally {
    rl.close()
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
