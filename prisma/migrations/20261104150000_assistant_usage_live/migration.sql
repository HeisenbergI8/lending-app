-- Ask Pondex: Groq's own rate-limit figures from each answer, so the chat header can show real numbers.
-- New nullable columns on AssistantUsage only; no other table or row changes.

-- AlterTable
ALTER TABLE "AssistantUsage" ADD COLUMN "requestsLeft" INTEGER,
ADD COLUMN "requestLimit" INTEGER,
ADD COLUMN "minuteTokensLeft" INTEGER,
ADD COLUMN "minuteResetAt" TIMESTAMP(3),
ADD COLUMN "lastUsedAt" TIMESTAMP(3);
