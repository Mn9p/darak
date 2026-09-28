// The Prisma monorepo plugin ships no type declarations. Used only in next.config.ts (webpack server plugins).
declare module "@prisma/nextjs-monorepo-workaround-plugin" {
  export class PrismaPlugin {
    constructor(options?: Record<string, unknown>);
    apply(compiler: unknown): void;
  }
}
