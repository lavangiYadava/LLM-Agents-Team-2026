<general_rules>
- Always use Yarn as the package manager - never use npm or other package managers
- Run all general commands (e.g. not for starting a server) from the repository root using Turbo orchestration (yarn build, yarn lint, yarn format)
- Before creating new utilities or shared functions, search in packages/shared/src to see if one already exists
- When importing from the shared package, use the @openswe/shared namespace with specific module paths
- Follow strict TypeScript practices - the codebase uses strict mode across all packages
- Use ESLint and Prettier for code quality - run yarn lint:fix and yarn format before committing
- Console logging is prohibited in the open-swe app (ESLint error) - use the `createLogger` function to create a new logger instance instead
- Import the logger from `apps/open-swe/src/utils/logger.ts` and use the exported `LogLevel` enum when creating a logger (e.g. `createLogger(LogLevel.INFO, "MyComponent")`).
- Build the shared package first before other packages can consume it (yarn build from the root handles this automatically via turbo repo)
- Follow existing code patterns and maintain consistency with the established architecture
- This repository is deprecated and no longer actively maintained; prefer minimal, conservative changes aligned with existing patterns
- Include as few inline comments as possible
</general_rules>

<repository_structure>
This is a Yarn workspace monorepo with Turbo build orchestration containing these workspace apps and packages:

**apps/open-swe**: Primary LangGraph agent application
- Core LangChain/LangGraph agent implementation with TypeScript
- Contains three graphs: programmer, planner, and manager (configured in `langgraph.json`)
- Uses strict ESLint rules including no-console errors

- Contains additional runtime and tools folders used by the agent:
  - `apps/open-swe/src/runtime` — runtime helpers, budget and failure handling, checkpoint logic and failure policies (see `runtime/failure/policies`).
  - `apps/open-swe/src/tools` — built-in agent tools (examples: `apply-patch.ts`, `shell.ts`, `grep.ts`, `search-documents-for`). These are the canonical implementations for tool integrations used by the graphs.
- The LangGraph HTTP app entry is `apps/open-swe/src/routes/app.ts`. `langgraph.json` also exposes configurable HTTP headers used by routes (examples: `x-github-pat`, `x-local-mode`, `x-github-installation-token`) — these are declared in the root `langgraph.json` under `http.configurable_headers.include`.

**apps/open-swe-v2**: LangGraph agent V2 application
- Alternative agent implementation with its own package and test tooling
- Has its own `langgraph.json` (`apps/open-swe-v2/langgraph.json`) with a single `coding` graph (entry: `./src/agent.ts:agent`)
- `apps/open-swe-v2` `yarn dev` currently runs `langgraphjs` with the root config (`../../langgraph.json`), not `apps/open-swe-v2/langgraph.json`

**apps/web**: Next.js 16 web interface
- React 19 frontend with Shadcn UI components (wrapped Radix UI) and Tailwind CSS
- Modern web stack with TypeScript, ESLint, and Prettier with Tailwind plugin
- Serves as the user interface for the LangGraph agent

**apps/cli**: Ink-based terminal interface
- React + Ink CLI for local codebase chat and real-time streaming logs
- Works directly on a local git repository without GitHub authentication

**apps/docs**: Documentation site
- Mint-powered docs site for setup and usage guides
- Source files live under `apps/docs`

**packages/shared**: Common utilities package
- Central workspace dependency providing shared types, constants, and utilities
- Exports modules via @openswe/shared namespace (e.g., @openswe/shared/open-swe/types)
- Must be built before other packages can import from it
- Contains crypto utilities, GraphState types, failure handling types and errors, and open-swe specific modules

**Root Configuration**:
- turbo.json: Build orchestration with task dependencies and parallel execution
- .yarnrc.yml: Yarn 3.5.1 configuration with node-modules linker
- tsconfig.json: Base TypeScript configuration extended by all packages
</repository_structure>

<dependencies_and_installation>
**Package Manager**: Use Yarn exclusively (configured in .yarnrc.yml)

**Installation Process**:
- Run `yarn install` from the repository root - this handles all workspace dependencies automatically

**Development**:
- Use `yarn dev` from the repository root to run `turbo dev` for local development across workspaces. The root `package.json` also exposes `yarn build`, `yarn test`, `yarn format`, `yarn format:check`, `yarn lint`, `yarn lint:fix`, `yarn clean`, and `yarn turbo:command`, which map to Turbo commands that operate across packages.

**Key Dependencies**:
- LangChain ecosystem: @langchain/langgraph, @langchain/anthropic for agent functionality
- Next.js 16 with React 19 for web interface
- Ink + React for the CLI terminal interface
- Shadcn UI (wrapped Radix UI) and Tailwind CSS for component library and styling
- Mint for the documentation site
- TypeScript with strict mode across all packages
- Jest with ts-jest for testing framework

**Workspace Structure**: Dependencies are managed on a per-package basis, meaning dependencies should only be installed in their specific app/package. Individual packages reference the shared package via @openswe/shared workspace dependency.
</dependencies_and_installation>

<testing_instructions>
**Testing Framework**: Jest with TypeScript support via ts-jest preset and ESM module handling

**Test Types**:
- Unit tests: *.test.ts files (e.g., take-action.test.ts in __tests__ directories)
- Integration tests: *.int.test.ts files (e.g., telemetry-integration.int.test.ts)

**Running Tests**:
- `yarn test` - Run unit tests across all packages
- Use package-level `test:int` scripts in `apps/open-swe`, `packages/shared`, and `apps/open-swe-v2` when you need integration tests
- Use package-level `test:single <file>` scripts from the package that defines them for focused test runs
- In `apps/open-swe-v2`, `eval:single` currently references `ls.vitest.config.ts`, but that config file exists in `apps/open-swe` only

**Test Configuration**:
- 20-second timeout for longer-running tests
- Environment variables loaded via dotenv integration
- ESM module support with .js extension mapping
- Pass-with-no-tests setting for CI/CD compatibility

**Writing Tests**: Focus on testing core business logic, utilities, and agent functionality. Integration tests should verify end-to-end workflows. Use the existing test patterns and maintain consistency with the established testing structure.
</testing_instructions>
