import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'vulnops-security-agent',
    description: 'Local-first multi-agent AppSec workflow for recon, Ghost evidence generation, discovery, triage, and reporting.',
    docsPath: 'docs',
  },

  provider: 'opencode',

  agents: {
    lead: { instructionsPath: '.opencode/agents/security-agent-lead.md' },
    explorer: {
      instructionsPath: null,
      allowedPaths: ['docs', '.opencode', 'src', 'targets'],
    },
    builder: {
      instructionsPath: null,
      writablePaths: ['src', 'tests', 'docs', '.opencode', '.harness'],
    },
    reviewer: { instructionsPath: null },
    custom: [],
  },

  database: { type: 'sqlite', path: '.harness/harness.db' },

  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  },

  health: {
    scriptPath: './health.sh',
    required: true,
  },

  tools: {
    mcp: { enabled: true, port: 3742 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
})
