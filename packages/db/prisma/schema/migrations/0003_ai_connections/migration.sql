-- AI assistants connected over MCP (read-only, scoped to the connecting member's permissions).

-- CreateTable
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectHost" TEXT,
    "refreshVersion" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConnection_organizationId_idx" ON "AiConnection"("organizationId");

-- CreateIndex
CREATE INDEX "AiConnection_userId_idx" ON "AiConnection"("userId");

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
